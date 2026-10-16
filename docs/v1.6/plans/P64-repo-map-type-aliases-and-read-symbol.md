# P64 — Repo-map MCP: index the TypeScript declarations the vendored query misses, add `read_symbol`

Two mandates (`docs/v1.6/SPEC.md`'s P64 row). One: close the open non-trivial dogfooding entry
(`docs/v1.6/mcp-repo-map-issues.md`) — TypeScript `type` aliases are absent from the index and a
cross-language name collision resolves silently to the Go symbol. Two: investigate what else the
existing tree-sitter graph could answer, admitting a capability only where it measurably cuts an
implementing agent's tokens.

Everything below was read directly or measured against the live server and the live
`codeindex.db`, not inferred.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is the alias gap a missing capture, a missing kind, or a node-kind handler? | Missing capture patterns only. `definitionKinds` (`extract.go:64`) already admits `type`, `enum`, `constant`. The vendored `queries/typescript/tags.scm` has 23 lines and no `type_alias_declaration` pattern | §2.1 |
| Is the gap only type aliases? | No. Measured: **0** `type`, **0** `constant`, **0** `enum` symbols for typescript/tsx/vue across the whole index. 369 type aliases, ~387 module-level consts, 10 enums are invisible. `outline_file packages/shared/domain/tree.ts` returns 7 nodes for a file with 23 indexable top-level declarations | §1.4 |
| Do consts/enums belong in this phase? | Yes — same root cause, same file, same rebuild, and P65 measures this tool. Scoped as a deliberate decision, not creep | §2.3 |
| Why does `find_definition TreeNode` return one confident hit rather than disambiguating? | The disambiguation path already exists and is correct (`locator.go:103`, `renderAmbiguous`). It never fires because only one symbol named `TreeNode` is indexed. Indexing the alias makes it fire | §1.5 |
| Is that enough? | No. `sortCandidates` (`resolve.go:206`) has no language rule, so a position-resolved lookup from a `.ts` file still ranks the Go struct first via `commonPrefixLen`. Needs a same-language tiebreak | §2.4 |
| Signature/pattern search (SPEC's named candidate) | **Declined**, with the measurement. `grep` returns the same answer in the same shape at the same cost, and the gap P63 actually hit was a body-content search no declaration-scoped tool answers | §5.1 |
| What else? | `read_symbol` — return a symbol's exact declaration source. Measured: median function/method is **8 lines**; its file is a median **268 lines** | §3 |
| Migration needed for the query change? | No. `codeparse.Fingerprint` hashes every embedded query file's bytes (`fingerprint.go:61-72`); `checkFingerprint` (`sync.go:343`) truncates and rebuilds on mismatch. Editing a `.scm` rebuilds the cache automatically | §1.7 |

## 1. Confirmed current state

### 1.1 Where the code is

Not at repo root — `apps/kira-studio/internal/`. Three packages, one pipeline:

- `codeparse/` — the only package importing tree-sitter. Parses, runs each language's composed
  query, returns plain `Symbol`/`Reference`/`Block` structs.
- `codeindex/` — SQLite cache (`codeindex.db` under `KIRA_HOME`), one shared file, `repo_id`-scoped.
- `codegraph/` — resolution over stored rows, computed live, no edge table.
- `repomap/` — the six-tool MCP server in front of `codegraph`.

Sizes: `codeparse` 1433 lines, `repomap` 1656, `codegraph` 2311, `codeindex` 2869.

### 1.2 How a TypeScript declaration becomes a row

1. `session.go:283` calls `extractSymbols(root, content, lang)`; for a Vue/Svelte/HTML container it
   calls `injectBlocks` first (`inject.go:153` parses each block as its own tree, so an injected
   `<script setup>` block's root is a `program` node, same as a `.ts` file).
2. `extract.go:79-174` runs the language's one composed `*sitter.Query` and walks matches. A capture
   named `definition.<kind>` plus a `@name` capture yields a `Symbol`; `reference.<kind>` plus
   `@name` yields a `Reference`. Anything else is ignored, never an error.
3. `definitionKinds` (`extract.go:64-68`) is the closed set: `class interface struct enum type
   function method constructor field constant variable module macro`.
4. `queries.go:56-64` composes TypeScript's query as `javascript/tags.scm` + `typescript/tags.scm` +
   `typescript/c2_implements.scm`; TSX the same with its own `c2_implements.scm`.
5. `codeindex` writes `symbol` rows carrying kind, name, full span (`start_byte`/`end_byte`,
   `start_row`/`end_row`), name span, and `parent_id` (`migrations/0001_c1_init.sql`).

So `type` is an admitted kind with no producer for TypeScript. The whole defect is upstream of
step 3.

### 1.3 The vendored TypeScript query, read in full

`queries/typescript/tags.scm` — 23 lines, six definition patterns and two reference patterns:

```
function_signature        -> @definition.function
method_signature          -> @definition.method
abstract_method_signature -> @definition.method
abstract_class_declaration-> @definition.class
module                    -> @definition.module
interface_declaration     -> @definition.interface
type_annotation           -> @reference.type
new_expression            -> @reference.class
```

No `type_alias_declaration`. No `enum_declaration`.

`queries/javascript/tags.scm` (99 lines, composed first) supplies class/method/function, plus
`const`/`var` **only when the value is an `arrow_function` or `function_expression`** (lines 41-61),
plus one `@definition.constant` pattern that matches CommonJS `export_statement value:
(assignment_expression …)` (lines 90-99) — not ESM `export const X = …`.

Upstream's own comment in `queries.go:51-55` already records that `typescript/tags.scm` is an
*addition* to the JavaScript file, not a standalone one. The addition simply never covered type
aliases, enums or non-function consts.

### 1.4 Measured: what is missing

Symbol counts by language and kind, from the live `codeindex.db`, this working tree's own
`repo_id`:

| language | function | method | interface | class | type | constant | enum |
|---|---|---|---|---|---|---|---|
| go | 4202 | 1811 | — | — | **1274** | — | — |
| typescript | 3241 | 1088 | 647 | 112 | **0** | **0** | **0** |
| vue | 1208 | 13 | 22 | — | **0** | **0** | **0** |

`tsx` has no rows at all — this repository has zero `.tsx` files. The TSX query is still updated
alongside TypeScript's (§2.2): the language is registered, and letting the two drift is how the
next repository served by this server inherits the bug.

Counted in the working tree, none of them indexed:

- 339 `type X = …` aliases in `.ts`, plus 30 more inside `.vue` script blocks — 369 total.
- 97 of those are `export type X = z.infer<typeof …>` — the shared domain vocabulary.
- 388 top-level `export const …`, of which exactly **1** is arrow-valued (so 387 are invisible;
  this repo writes `export function`, not `export const … = () =>`).
- 10 `enum` declarations.

One file makes the size of it concrete. `outline_file packages/shared/domain/tree.ts` returns:

```
function isNodeKind, interface PathSegment, interface NodePath,
function encodePath, decodePath, pathParent, pathTail
```

Seven nodes. The file's real top-level declarations include `nodeKindSchema`, `NodeKind`,
`treeNodeSchema`, `TreeNode`, `columnMetaSchema`, `ColumnMeta`, `indexMetaSchema`, `IndexMeta`,
`foreignKeyMetaSchema`, `ForeignKeyMeta`, `objectMetaSchema`, `ObjectMeta`, `relationColumnsSchema`,
`RelationColumns` — sixteen more (7 aliases, 9 module-level consts), none listed. 23 in all.
`outline_file`'s tool description calls itself "the cheapest way to see what a file contains";
today it shows under a third of this one.

Reproduced against the live server (P64 planning session, fresh index):

```
find_definition {"symbol":"TreeNode"}      -> 1 definition, internal/storage/model/tree.go:33
search_symbols  {"query":"BrowseTab"}      -> no symbols matching "BrowseTab"
find_definition {"symbol":"BrowseTabState"}-> no symbol named "BrowseTabState" found
search_symbols  {"query":"treeNodeSchema"} -> no symbols matching "treeNodeSchema"
find_references {"symbol":"BrowseTabState"}-> no references found
```

The last line is worse than the logged entry states. `type_annotation` **does** produce
`@reference.type` rows for these names, so the references exist — but `locate` (`locator.go:88`)
reaches them only through a symbol-table lookup, so a missing definition makes the references
unreachable too. The gap blocks all three navigation tools, not one.

### 1.5 Why one confident wrong hit, and not an error or a list

`locator.go:94-105` already handles collisions: zero exact matches means empty, one means proceed,
several means `ambiguous`, rendered by `renderAmbiguous` (`render.go:213`) as "N symbols named X —
re-call with file set to one of these", each candidate carrying its own source line. That is the
right behaviour and it is already built.

It never fires for `TreeNode` because the index holds exactly one symbol by that name. The silent
wrong answer is a pure consequence of the missing row, not a second defect in the resolver. Indexing
the alias turns the same query into a two-candidate disambiguation with no new rendering code.

One thing *is* a second defect. `sortCandidates` (`resolve.go:206-231`) ranks by, in order:
same-file rank, `kindCompatible`, `basenameMatches`, `commonPrefixLen`, test path, parse error, path,
start byte. There is no language rule anywhere. Worked through for a real case — reference at
`apps/kira-studio/frontend/src/project/filter.ts:20`:

- `basenameMatches` needs `basename == symbol name`; "tree" != "TreeNode", so false for both.
- `commonPrefixLen` against `apps/kira-studio/internal/storage/model/tree.go` is 17 characters
  (`apps/kira-studio/`); against `packages/shared/domain/tree.ts` it is 0.

The Go struct therefore ranks **first** even after the alias is indexed. Both are returned
(`maxCandidates` is 16, `resolve.go:14`), so nothing is hidden — but the frontend question still
reads back with the backend type on the first line. §2.4 fixes that.

### 1.6 What the parse already carries that no tool surfaces

Read against the schema and `codegraph.Target` (`codegraph.go:52-65`):

| Carried | Surfaced today |
|---|---|
| Full declaration span — `start_byte`/`end_byte`, `start_row`/`end_row` | **No.** Every renderer prints `NameSpan.Start` only; the body is never reachable |
| `symbol.kind` | Yes — `kinds` filter, printed on each hit |
| `parent_id` container chain | Yes — `outline_file`, `targetLabel` |
| `file.line_count` | **No.** `renderFileSearch` prints path and language only |
| `file.path` | Filterable? **No** — `SearchSymbols` joins `file` (`read.go:260`) but exposes only `kinds`/`languages` |
| `file.parse_status`, `has_error` | Used internally as a ranking tiebreak; not printed |
| Doc comments | **Not stored.** The `@doc` captures are read and discarded (`extract.go:119-120`) |
| Import edges | **Not stored, and not captured.** No query file in the tree emits `@reference.import` — verified by grep across all ten `.scm` files. `referenceKinds` admits the kind; nothing produces it |

The first row is the material gap and is what §3 builds on. The last row is what §5.2 declines.

### 1.7 Cache invalidation is automatic

`codeparse.Fingerprint` (`fingerprint.go:40-75`) hashes every linked grammar module version,
`extractionVersion`, **and every embedded query file's own bytes**. `Index.Sync` calls
`checkFingerprint` (`sync.go:51`, `343`) first; a mismatch against stored `meta.parser_fingerprint`
truncates the repository's rows and rebuilds. Covered by
`TestSync_FingerprintMismatchTruncatesRepo` (`sync_test.go:274`).

Consequences for this phase:

- Editing a `.scm` file needs **no migration and no `extractionVersion` bump**. The next `Sync`
  reindexes the whole repository by itself.
- `extract.go` is not being changed, so `extractionVersion` stays at 2.
- `codegraph` changes (§2.4) are query-time, not stored — no rebuild at all.
- A full reindex of this repository is ~1800 files. Observed cold-start on this container: index
  ready inside 30s. Budget that in verification, don't call it a hang.

## 2. Part 1 — the fix

### 2.1 Root cause, stated once

The vendored `tree-sitter-typescript` v0.23.2 `tags.scm` has no `type_alias_declaration` pattern.
Editors supply their own; this repo vendors upstream's file verbatim (`queries.go:38`,
`Provenance`). Nothing downstream is wrong: the kind vocabulary admits `type`, the writer stores
whatever it is handed, the resolver ranks whatever exists, the renderer disambiguates whenever there
is something to disambiguate.

### 2.2 The patterns to add

All node kinds and field names below were verified against the pinned grammar's own
`node-types.json` (`tree-sitter-typescript@v0.23.2`, both the `typescript/` and `tsx/` variants —
identical for every node used here).

Because this repository vendors upstream's `tags.scm` unmodified and records that in `Provenance`
(`queries.go:34-47`), the new patterns go in **new repo-authored files**, not into the vendored one
— the same split `c2_implements.scm` already established:

- `queries/typescript/p64_declarations.scm`
- `queries/tsx/p64_declarations.scm` (identical text, compiled against TSX's own `*sitter.Language`
  — same reason `tsx/c2_implements.scm` exists as its own file)

Contents:

```scheme
; Type aliases — `type X = …`, exported or not, anywhere in the tree.
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; Enums — `enum X { … }` / `const enum X { … }`.
(enum_declaration
  name: (identifier) @name) @definition.enum

; Module-level `const` bound to a non-function value. Anchored at `program` (and at an
; export_statement directly under it) so a local inside a function body never becomes a symbol.
; The value list enumerates non-function expression kinds rather than excluding function ones:
; tree-sitter queries cannot negate a child, and javascript/tags.scm's own @definition.constant
; pattern already enumerates its value types the same way.
(program
  (lexical_declaration
    kind: "const"
    (variable_declarator
      name: (identifier) @name
      value: [
        (call_expression) (object) (array) (string) (template_string) (number)
        (new_expression) (member_expression) (identifier) (binary_expression)
        (unary_expression) (as_expression) (satisfies_expression)
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
          (unary_expression) (as_expression) (satisfies_expression)
          (true) (false) (null) (undefined)
        ]))) @definition.constant)
```

Notes the implementer needs:

- `lexical_declaration` has a real named field `kind`, whose types are the anonymous nodes `const`
  and `let`. `kind: "const"` is the field-plus-anonymous-node query form. If that form fails to
  compile, `queryFor` returns the error immediately and every `codeparse` test fails loudly — it
  cannot ship silently broken. Fallback if it does fail: drop the `kind:` constraint and file the
  result under `@definition.variable` instead, which is honest for both `const` and `let`.
- `let` at module scope is deliberately **not** captured. Rare in this repo, and a mutable module
  binding is not a navigation target worth the name-space pollution.
- The `program` anchor works for Vue/Svelte SFCs: `injectBlocks` parses each script block as its own
  tree (`inject.go:153`), so a block's top-level `const` is a direct `program` child.
- `type_alias_declaration` and `enum_declaration` are **not** anchored. Both are real definitions
  wherever they appear, and `linkParents` files a nested one under its enclosing symbol already.

Register the two files in `queries.go`: add both paths to the `//go:embed` line (`queries.go:11`),
append each to its language's `querySourcePaths` entry (`queries.go:60-61`), and add two
`Provenance` rows with `UpstreamModule: thisRepo` (`queries.go:34-47`), matching how the
`c2_implements.scm` rows are recorded.

### 2.3 Why consts and enums are in scope

SPEC names type aliases. Consts and enums are the same defect class — a missing capture in the same
composed query, fixed by the same two new query files, rebuilt by the same fingerprint change, with
no additional risk surface. Three reasons to take them here rather than defer:

1. `outline_file` on a domain file shows 7 of 23 declarations today (§1.4). A caller cannot tell a
   short file from a badly-indexed one, so the tool's own "cheapest way to see what a file contains"
   claim is currently false.
2. Every zod schema in this repo is a `const`. `treeNodeSchema` is exactly as navigable-by as
   `TreeNode`, and a phase touching shared domain types needs both.
3. P65 measures this server against a no-MCP baseline. Measuring a knowingly half-fixed tool wastes
   the measurement.

Cost to weigh against that: +766 symbols on ~6300 TypeScript-family symbols, about +12%. Negligible
for index size; for `search_symbols` noise it is the point, not a side effect.

Duplicate risk, checked: the new const patterns enumerate non-function values, so they cannot
double up with `javascript/tags.scm`'s arrow-valued `@definition.function` pattern. Resolution
noise, checked: `kindCompatibility` (`resolve.go:22-25`) lists neither `constant` nor `variable`
under any reference kind, so a new const symbol is demoted — never dropped — as a candidate for a
`call` or `type` reference. That is the existing design handling it, not a change.

### 2.4 Same-language candidates rank first

Add one tiebreak to `sortCandidates` (`resolve.go:206`), inserted **after** the `kindCompatible`
comparison and **before** `basenameMatches`:

```go
// languageFamily groups languages that can genuinely define one another's names. A name shared
// across two families is a collision, not a resolution — rank the referring file's own family
// first rather than letting commonPrefixLen decide by directory accident.
var languageFamily = map[string]string{
	"javascript": "js", "typescript": "js", "tsx": "js", "vue": "js", "svelte": "js", "html": "js",
	"go": "go", "java": "java", "python": "python", "rust": "rust",
}

func sameLanguageFamily(refLanguage, candidateLanguage string) bool { … }
```

Rules:

- A demotion, never a filter — same posture `kindCompatibility`'s own doc comment states
  (`resolve.go:16-19`). Both candidates still come back.
- A no-op when the referring file's language is absent from the map (css/json), so nothing outside
  the symbol-bearing set changes behaviour.
- Placed below `kindCompatible` because what a reference syntactically *is* outranks which half of a
  polyglot repository it lives in; placed above `basenameMatches`/`commonPrefixLen` because those
  two are path heuristics and this is a hard fact about the language.

Effect on the logged case: a `TreeNode` type reference in a `.ts` file ranks
`packages/shared/domain/tree.ts` first and `internal/storage/model/tree.go` second. Confidence
stays `repoWide` on both (both are tier 2) — honest, and unchanged.

Second effect, deliberate: `find_references` in the default `Resolved` mode keeps references whose
own winning target intersects the query's target (`references.go`). With the family rule, TypeScript
sites resolve to the alias and Go sites to the struct, so `find_references` on either stops mixing
the two languages' 112 combined hits into one list.

### 2.5 `languages` on the locator

`search_symbols` already takes `languages []string` (`tools.go:202`), threaded to a
`f.language IN (…)` clause (`read.go:279-284`). `find_definition`/`find_references`/
`find_implementations` take no such filter, so resolving an ambiguity costs a second call with an
explicit `file`.

Add `Languages []string` to `locatorFields` (`tools.go:35-43`) — the same field name, same type,
same semantics as `search_symbols`, so no new vocabulary. Thread it through `locateArgs` into the
symbol-alone branch's `SearchSymbols` call (`locator.go:89`). No effect when a `file` is given.

`{"symbol":"TreeNode","languages":["typescript","tsx","vue"]}` then resolves in one call. Plural and
explicit rather than a singular `language` with an invented `js` alias: a `.vue`-declared alias is
stored under language `vue`, not `typescript`, and a caller must be able to say so.

Update `renderAmbiguous`'s one line (`render.go:215`) to name both escapes — "re-call with `file` or
`languages` set" — so the tool's own output teaches the cheaper path.

### 2.6 What the fix does not change

- No schema migration, no `extractionVersion` bump (§1.7).
- No change to `extract.go`, `definitionKinds`, or `referenceKinds`.
- No change to the vendored `tags.scm` files.
- No new reference kinds. `type_alias_declaration`'s right-hand side is not walked for references;
  `type_annotation` already covers the use sites this repo navigates by.
- Go, Java, Python, Rust queries untouched.

### 2.7 Verification, against the exact logged case

Rebuild, restart, wait for the reindex, then re-run §1.4's reproductions. Required answers:

| Call | Required result |
|---|---|
| `find_definition {"symbol":"TreeNode"}` | 2 candidates, ambiguous, `packages/shared/domain/tree.ts:96` present and listed **first** |
| `find_definition {"symbol":"TreeNode","languages":["typescript"]}` | 1 definition, `packages/shared/domain/tree.ts:96` |
| `find_definition {"symbol":"BrowseTabState"}` | 1 definition, `packages/shared/domain/tabs.ts:204` |
| `search_symbols {"query":"BrowseTab"}` | `BrowseTabState` and `BrowseTabRecord` both present |
| `search_symbols {"query":"treeNodeSchema"}` | 1 hit, `packages/shared/domain/tree.ts:88` |
| `find_references {"symbol":"BrowseTabState"}` | non-empty |
| `outline_file {"file":"packages/shared/domain/tree.ts"}` | 23 nodes, not 7 |

## 3. Part 2, accepted — `read_symbol`

### 3.1 The query it answers

"Show me this function/type/component, and nothing else."

Today that is a two-step with a guess: `find_definition` gives `path:line`, then `Read` either the
whole file or a window whose size the agent invents, because the end line is not in the answer.
`outline_file` gives names and start lines, still no extents. Nothing in the six tools returns a
declaration's body.

The server already knows the exact extent. `symbol.end_row`/`end_byte` are stored
(`0001_c1_init.sql`), carried into `Target.Span` (`position.go:22`), and dropped by every renderer,
all of which print `NameSpan.Start` only.

### 3.2 Measured savings

From the live index, this repository's own `repo_id`, `function` and `method` symbols in
go/typescript/tsx/vue, 11563 of them:

- symbol extent: median **8** lines, mean 14.8, p90 **34**
- containing file: median **268** lines, mean 377
- median ratio file:symbol — **31x**

So against a whole-file `Read`, the median lookup returns ~8 lines where ~268 are read: roughly
3.2k tokens saved on one call, ~30 tokens spent. Against a *disciplined* baseline — `find_definition`
then `Read offset=<start> limit=80`, which is about the smallest window an agent can pick without
knowing the extent — it is 8 lines against 80, a 10x cut, and it removes the under-read-then-re-read
loop entirely.

Two honest qualifications. An agent often wants surrounding context, so not every whole-file read is
waste. And p90 extent (34 lines) narrows the win on the large functions an implementer most often
needs. Even at p90 against a 268-line file the ratio is ~8x.

A case from this planning session, which read the code by hand: `resolveName`
(`codegraph/resolve.go`) was reached with two windowed reads totalling ~190 lines because its extent
was unknown. The symbol is `resolve.go:266-350`, 2543 bytes; the file is 12353.
`read_symbol {"symbol":"resolveName"}` would have been one call and ~1.6k fewer tokens.

### 3.3 Query shape

```
read_symbol {
  ...locatorFields            // file+line(+column), file+symbol, symbol alone, languages
  omitDoc:     bool           // default false — the preceding comment block is included
  maxLines:    int            // default 400, max 1000
}
```

Reusing `locatorFields` matters: `read_symbol` then accepts exactly what `find_definition` accepts,
including the same ambiguity and `languages` behaviour, so an agent that can navigate can already
read. It uses `s.resolve` + `graph.DefinitionOf` unchanged.

### 3.4 Response shape

Grep-like header, then the source, matching `render.go`'s existing voice:

```
packages/shared/domain/tree.ts:88-95  constant treeNodeSchema  exact  self
export const treeNodeSchema = /*#__PURE__*/ z.object({
  kind: nodeKindSchema,
  ...
});
```

Rules, each mirroring an existing convention:

- One header line per target, identical in shape to `renderTargetLine` (`render.go:53`) except the
  position carries the line **range**. Several targets (an ambiguous resolution reaching
  `DefinitionOf` through a `file`+`symbol` hit) print in sequence.
- Body lines are **not** indented and **not** trimmed — this is source, not a hit continuation, and
  indentation is information here. That is a deliberate divergence from `writeSource`
  (`render.go:22`), whose four-space indent exists to keep a continuation distinguishable from a hit
  line; a fenced multi-line body needs no such guard.
- `[stale]` on the header when the file no longer matches the indexed row
  (`FileRow.MatchesDisk`, the rule `sourceForOneFile` already applies at `source.go:269`). A stale
  read is the one case where the printed body may not be the symbol at all, so it is marked, not
  suppressed.
- Doc comment: walk backwards from the declaration's start row while each preceding line, trimmed,
  begins with `//`, `/*`, `*`, `*/` or `#`, stopping at 40 lines or a blank line. Printed above the
  header, unindented. This repo's Go doc comments carry the design rationale — a body without them
  is half the answer. `omitDoc` turns it off.
- Caps: `maxLines` (default 400) and a 64 KiB byte ceiling; whichever binds first cuts the body and
  appends `… truncated at N lines (symbol spans M)`, so a caller always knows it got a prefix.
  Per-line truncation stays at `sourceLineMaxBytes` (512, `source.go:20`).
- Every failure degrades to a note, never a tool error — the same table `sourceForOneFile` already
  implements (deleted file, path outside repository, non-regular file, NUL byte).

### 3.5 Implementation

`source.go` already does almost all of it. `readRows` (`source.go:116-152`) reads an arbitrary set of
rows in one forward pass from row 0 and stops at the highest wanted row — a contiguous range is just
a dense row set, so the existing function works unchanged. What is new:

- `readSymbolRows(path string, startRow, endRow, docLookback int) ([]string, …)` in `source.go`,
  built on `sourceForOneFile`'s existing resolve/open/stat/stale sequence; request rows
  `max(0, startRow-docLookback) … endRow`, then walk the doc block backwards in the result.
- `renderSymbolSource(targets, bodies)` in `render.go`.
- `readSymbolArgs` + `Server.readSymbol` in `tools.go`, and one `mcp.AddTool` registration in
  `buildMCPServer` (`server.go:198-221`).

Tool description, held to the register `instructions` (`server.go:187`) sets:

> Read a symbol's own declaration source — its exact extent from the index, not a guessed window.
> Prefer it to opening the file when you need one function, type or component.

Estimated 180-220 lines of Go across the three files.

### 3.6 Why not just print the end line on every hit

Considered and dropped. Adding `:88-95` to every hit costs ~3 tokens on every line of every
`search_symbols` response (30 hits) to serve a case `read_symbol` serves in one call rather than two.
If `read_symbol` ships, the range annotation is redundant noise everywhere it is not used.

## 4. Part 2, accepted — two small additions

Both are small by declaration, not by hedging: each is a handful of lines with a modest, stated
saving.

### 4.1 `pathPrefix` on `search_symbols` and `search_files`

`store.SearchSymbols` already joins `file` (`read.go:260-268`). Add an optional
`AND f.path LIKE ? ESCAPE '\'` clause (the prefix pattern built the same way `escapeLike` already
builds the others, `search.go:19`), a `PathPrefix string` field on `SymbolSearch`/`FileSearch`, and
the matching argument on both tools.

Cost today: a 30-hit `search_symbols` response measures ~4.4k bytes (~1.1k tokens) against the live
server. `languages` cannot separate this monorepo's three TypeScript trees — the app frontend, the
VS Code extension and `packages/` — so narrowing means either eating the full result or making a
second call. `pathPrefix:"packages/"` cuts a typical response to a handful of hits —
call it 700-900 tokens per over-broad search, a few times a phase. Small, real, ~20 lines.

### 4.2 Line count in `search_files`

`SearchFiles` already returns `FileRow.LineCount` (`read.go:321-345`); `renderFileSearch`
(`render.go:157`) prints path and language and discards it. Print it:

```
packages/shared/domain/tree.ts  typescript  154
```

Two tokens per row, and it is what an agent needs to choose between reading a file whole and reaching
for `read_symbol`.

## 5. Considered and declined

### 5.1 Signature/pattern search — declined

SPEC names it as a confirmed candidate. Checked against what the index actually holds and against
the gap it is supposed to close, it does not earn its place.

**It cannot be built cheaply.** Declaration *text* is not stored — `symbol` holds byte offsets and
row/column, no source (`0001_c1_init.sql`). Searching declaration lines therefore means either a new
`signature TEXT` column plus a migration plus a sync-path write, or reading every candidate file from
disk per query. The second is prohibitive: `sourceFor` costs one open and one forward scan per file
(`source.go:211-229`), and a repository-wide declaration search touches every indexed file.

**The savings claim does not survive measurement.** P63's planning agent hunted for "some function
doing bulk writes" with `grep -rn "Pipeline|TxPipeline|func (a \*Adapter)"`. Re-run over the Redis
adapter: 17 matches, 2664 bytes, ~700 tokens, one call, already in `file:line:text` shape — and all
17 matched lines are declarations. A `signature_search` returning the same 17 declarations would cost
the same, plus kind and container. The token delta is approximately zero.

**It would not have answered the query anyway.** `TxPipeline` in that hunt appears in function
*bodies*, not signatures. A declaration-scoped search by construction cannot find "a function that
calls `TxPipeline`". The concrete gap SPEC cites as the motivation is a body-content search, which is
`grep`'s job and remains `grep`'s job.

Where a declaration-scoped search would genuinely beat `grep` is precision — excluding matches inside
bodies, comments and strings, and matching a multi-line signature `grep` splits. Real, but narrow,
and not worth a schema migration plus a sync-path write plus a tool when `grep` with a tighter
pattern and `--include` closes most of it for free.

### 5.2 Import/dependency graph — declined

The appeal is "what depends on this file". The obstacles:

- **Nothing is indexed.** `referenceKinds` admits `import` (`extract.go:71`), but no query file in
  the tree emits `@reference.import` — verified by grep across all ten `.scm` files. Go's
  `tags.scm:38` captures `(import_declaration (import_spec) @name)` with no `@definition`/
  `@reference` capture at all, so `extract.go`'s own documented rule (`extract.go:168-169`) produces
  no row. The TypeScript and JavaScript files have no import pattern whatsoever.
- **Capturing is the easy half.** A module specifier is a string; turning it into a repository path
  needs per-language resolution: TypeScript relative paths with implicit extensions and `index`
  files, this repo's `@kira/*` workspace aliases, Bun workspace package names, and Go's
  module-path-to-directory mapping. That is a real resolver, not a query pattern, and it is exactly
  the kind of thing `codegraph`'s own package doc declines ("no edge table, ever" —
  `codegraph.go:3-5`).
- **The query is cheap today.** "What does this file import" is a `Read` with `limit=40` — the import
  block is at the top by construction. "What imports this file" is one `grep`.

Cost high, saving small, and it would put a cross-file derived edge into a package whose stated
design forbids one.

### 5.3 Storing doc comments as a column — declined

Tempting: the `@doc` captures already exist in the vendored queries and `extract.go:119-120`
deliberately discards them. But `read_symbol` (§3.4) gets the doc block from disk for free by
reading a few rows back from the declaration, with no schema change, no migration, no sync-path
write and no `extractionVersion` bump. A stored column would buy searchability over doc text, which
is `grep`'s job again.

### 5.4 Reference counts on search results — declined

"Which of these 12 same-named candidates is the real one" could be answered by annotating each hit
with its reference count. But it costs one `COUNT` query per hit on every `search_symbols` call —
paid by every caller, for a disambiguation the source line under each hit usually settles already
(that is what C8 added it for).

## 6. Files

New:

- `apps/kira-studio/internal/codeparse/queries/typescript/p64_declarations.scm`
- `apps/kira-studio/internal/codeparse/queries/tsx/p64_declarations.scm`

Changed:

- `codeparse/queries.go` — `//go:embed` list (line 11), `querySourcePaths` TypeScript/TSX entries
  (60-61), two `Provenance` rows (34-47)
- `codeparse/testdata/extract/sample.ts` — fixture gains a type alias, an enum, two module-level
  consts (one arrow-valued, to prove no duplicate row), one const inside a function body (to prove
  the `program` anchor holds)
- `codeparse/extract_test.go` — the TypeScript golden table
- `codegraph/resolve.go` — `languageFamily`, `sameLanguageFamily`, one tiebreak in `sortCandidates`
- `codegraph/search.go` — `PathPrefix` on `SymbolSearch`/`FileSearch`, threaded through
- `codegraph/codegraph.go` — the two search-option structs
- `codeindex/read.go` — `pathPrefix` parameter on `SearchSymbols`/`SearchFiles`
- `repomap/locator.go` — `Languages` on `locateArgs`, threaded into the symbol-alone branch
- `repomap/tools.go` — `Languages` on `locatorFields`, `pathPrefix` on the two search tools,
  `readSymbolArgs` + `Server.readSymbol`
- `repomap/source.go` — `readSymbolRows`
- `repomap/render.go` — `renderSymbolSource`, `renderAmbiguous`'s hint line, `renderFileSearch`'s
  line count
- `repomap/server.go` — one `mcp.AddTool`; "six-tool" in three comments (63, 101, 189)
- `repomap/conformance_test.go` — the tool-name set (144) and the call table (171)

Docs: `CLAUDE.md` (150-153, 167, 183-185), `docs/ARCHITECTURE.md` (949-971),
`docs/v1.6/mcp-repo-map-issues.md`.

## 7. Work order

One Sonnet subagent, sequential. The steps are order-dependent — the query change must be verified
before anything builds on the rows it produces.

1. Add the two `.scm` files, register them in `queries.go`. Build. A query that fails to compile
   fails here, loudly.
2. Extend `sample.ts` and the golden table. `go test ./internal/codeparse/...`. This is the gate:
   the exact captured set is asserted before the index is rebuilt.
3. Rebuild `kira-repo-map`, restart, let the fingerprint-driven reindex finish, run §2.7's table.
   Commit: `fix(repomap): index TypeScript type aliases, enums and module-level constants`.
4. `languageFamily` + the `sortCandidates` tiebreak, with its resolver test. Commit:
   `fix(codegraph): rank same-language candidates ahead of a cross-language name collision`.
5. `Languages` on the locator; `renderAmbiguous`'s hint line. Commit:
   `feat(repomap): filter a symbol-alone lookup by language`.
6. `read_symbol` — store/graph unchanged, `source.go` then `render.go` then `tools.go` then
   registration. Commit: `feat(repomap): add read_symbol`.
7. `pathPrefix` and the file line count. Commit: `feat(repomap): narrow searches by path prefix`.
8. Docs, and close the dogfooding entry.
   Commit: `docs(repomap): P64 — seven tools, closed alias entry`.

Typecheck/build/`go vet` per commit. The full `go test ./...` plus the live dogfooding pass runs once
at the end (§8, §9), per `CLAUDE.md`'s "implement the whole plan first, then test once".

## 8. Tests

`CLAUDE.md`'s bar: a test only for genuinely hard logic. Judged against the existing conventions in
these packages (`extract_test.go`'s golden tables, `resolve_test.go`'s 9 ranking tests,
`locator_test.go`'s 9 rule tests, `conformance_test.go`'s registration smoke test).

Add:

1. **`TestExtractGoldenFixtures`, TypeScript row** — extend, don't add. This is the anti-drift guard
   the test's own doc comment describes, and it is the only thing standing between a grammar bump
   and a silently empty index. The fixture must include a type alias, an enum, a module-level
   `export const` bound to a call expression, an arrow-valued `export const` (asserting **one**
   `function` row and no `constant` row), and a `const` inside a function body (asserting **no**
   row).
2. **One resolver test in `resolve_test.go`** — a `TreeNode`-shaped fixture: same name, two
   languages, the Go file sharing a longer path prefix with the referring TypeScript file. Asserts
   the TypeScript candidate ranks first and the Go candidate is still returned. This is the rule that
   is easy to get subtly wrong (insertion order inside an 8-way comparator) and impossible to see in
   a diff, so it earns a test.
3. **`conformance_test.go`** — the tool-name set and the call table gain `read_symbol`, keeping the
   registration smoke test complete.

Deliberately none for: the `Languages` passthrough (a filter argument threaded to an existing SQL
clause), `pathPrefix` (same), the line count in `renderFileSearch` (printing a field already read),
`read_symbol`'s happy path (a resolve plus a row read, both already covered — `source_test.go` has
8 tests on `readRows`). Each would restate a short function body.

One judgement call flagged: `read_symbol`'s **doc-comment backward walk** is a small loop with
interacting stop conditions (blank line, lookback cap, file start, a non-comment line). It sits just
under the bar. Add a test only if the implementation ends up with more than the three stop
conditions above; otherwise leave it.

## 9. Dogfooding

Same process as every prior phase (`CLAUDE.md`'s "Repo-map MCP server", `docs/v1.6/
mcp-repo-map-issues.md`'s own header). Two obligations here, not one.

**Close the open entry.** The P63 non-trivial entry flips to `Fixed (<sha>)` in place, never
deleted, with the commit from step 3 noted and a one-line statement of what the fix was — plus the
correction that the gap covered consts and enums too, and blocked `find_references` as well as
`find_definition`.

**Dogfood the new surface.** The implementing session navigates with the server as usual, and must
run at least: `read_symbol` against a Go method, a TypeScript type alias and a Vue SFC function
(three languages, three declaration shapes); `search_symbols` with `pathPrefix`; and
`find_definition` with `languages` on a genuinely colliding name. Whatever that finds gets logged
under the same trivial/non-trivial split — a non-trivial finding in P64's own new tool is logged and
**not** fixed in P64, exactly as the process requires, and waits for a dedicated pass before P65.

Two setup notes this phase inherits and should not rediscover. The server must be **rebuilt** before
dogfooding or it serves the old query set. After the rebuild the first `Sync` reindexes the whole
repository from scratch (fingerprint mismatch, §1.7) — roughly 1800 files, ready inside 30s on this
container; a tool call during that window answers "index is still building", which is correct
behaviour, not a fault.

## 10. Documentation to update

- **`CLAUDE.md`** — the tool list appears three times (152-153, 183-185) and "the six tools" twice
  (167, 183). Seven now, with `read_symbol` named. Keep the section's length: this file is
  prune-as-you-go.
- **`docs/ARCHITECTURE.md`** — the C3 paragraph at 947-953 says "Six tools, one per `codegraph`
  operation … plus `outline_file`". Amend to seven and state what `read_symbol` adds: the one tool
  that returns a declaration's own bytes, bounded by the indexed extent. The C8 paragraph at 965-971
  ends "`outline_file` and `search_files` are unchanged, so `outline_file`'s own 'without reading its
  bytes' still holds" — `search_files` now prints a line count and `read_symbol` reads bytes by
  design, so that sentence needs correcting rather than leaving quietly false.
- **`docs/DEV_ENVIRONMENT.md`** — no change expected. Check its repo-map section for a tool count
  before assuming so.
- **Known open items** — nothing opens or closes here.

## 11. Out of scope

- The Settings dialog's Code intelligence tab. Product surface, untouched; a new tool needs no UI.
- Any new language. The 11-language registration in `languages.go` is unchanged.
- JSX/TSX component-to-element edges, prop flow, Vue `defineProps` types. Each needs a type system.
- A `let`/`var` module binding as a symbol (§2.2).
- Type-aware resolution of any kind. Name-based is the design (`server.go:187`'s own instructions
  say so to every caller) and stays that way.
- Multi-repository serving. Still one `Server`, one repository (`server.go:4-7`).

## 12. Verification

Mechanical:

- `go build ./...`, `go vet ./...`, `go test ./...` from `apps/kira-studio`.
- `bun run mcp:repo-map:build` succeeds (cgo).
- `internal/layering_test.go` still passes — `repomap` must not gain a `bridge` import.

Live, against a restarted server on a completed reindex:

- §2.7's table, every row.
- `read_symbol {"symbol":"resolveName"}` returns the whole function with its doc comment and a
  `resolve.go:266-350` range header, and nothing from the rest of `resolve.go`.
- `read_symbol {"symbol":"TreeNode","languages":["typescript"]}` returns the alias line.
- `read_symbol` on a symbol in a file edited since indexing prints `[stale]`.
- `read_symbol` on a deleted file returns a note, not a tool error.
- `search_files {"query":"domain/tree"}` prints a line count per row.
- `search_symbols {"query":"open","pathPrefix":"packages/"}` returns strictly fewer hits than the
  same query without it.
- `tools/list` returns seven tools, each with a schema.

## 13. Open question for the implementer

`read_symbol`'s doc-comment walk uses a comment-prefix heuristic (`//`, `/*`, `*`, `*/`, `#`). It
will occasionally pick up a trailing comment that belongs to the *previous* declaration when no blank
line separates them. Accepted as honest over-inclusion — a caller gets one extra comment line, never
a wrong body. If it proves noisy in the §9 dogfooding pass, log it rather than widening the
heuristic mid-phase.
