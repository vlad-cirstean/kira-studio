# M1c — Repo-map MCP: index struct/class fields and their selector reads

Closes the non-trivial dogfooding entry logged in M1ab and reproduced during M2 planning
(`docs/v1.7/mcp-repo-map-issues.md`): `find_references` and `search_symbols` both answer nothing for
a Go struct field reached only through a selector expression.

Chapter `docs/v1.7/`, phasing row **M1c** in `docs/v1.7/SPEC.md`. Gates M2's implementation.

## 0. Sequencing gate

- M1ab has landed (`ae3b590e`). M2's plan is written; M2's *implementation* waits on this phase.
- Nothing in this phase touches `internal/dbmcp`, the connection model, or any frontend file. It is
  entirely `internal/codeparse` (four new query files, two edits) plus one `internal/codegraph`
  test.

## 1. Confirmed current state

### 1.1 The two failing calls

Logged twice, independently:

- `find_references` / `search_symbols` on `model.ConnectionFields.AutoExplain` and
  `.ThrottlePerSec` (M1ab arm A).
- Same on `model.ConnectionFields.McpEnabled` (M2 planning).

`ConnectionFields` is `apps/kira-studio/internal/storage/model/connection.go:7`, its three fields at
lines 24, 27 and 30.

One correction to the log: the `AutoExplain` uses are all in
`apps/kira-studio/internal/storage/repos/connections.go` (lines 63, 175, 208, 257, 308, 353, 366).
`internal/connections/service.go` names `AutoExplain` in comments only (lines 463, 472). The
`ThrottlePerSec` uses do span both packages. This matters only because §2.9's expected counts must
be right.

### 1.2 The Go query files, read in full

`apps/kira-studio/internal/codeparse/queries/go/` holds three files, composed in order by
`queries.go:90`:

- `tags.scm` (vendored, tree-sitter-go v0.25.0) — 42 lines. Patterns for `function_declaration`,
  `method_declaration`, `call_expression`, `type_spec`, `type_identifier`, `package_clause`,
  `import_declaration`, `var_declaration`, `const_declaration`.
- `p64b_declarations.scm` (repo-authored) — package-level `const`/`var`.
- `p67f_reads.scm` (repo-authored) — `range_clause`, `index_expression`, `argument_list`,
  `binary_expression`, `slice_expression`, all keyed on a bare `(identifier)`.

**No file in that set contains the string `field_declaration`.** Repository-wide, neither does any
other query file, for any language:

```
grep -rn 'definition.field\|field_declaration\|property_signature\|public_field_definition' \
  apps/kira-studio/internal/ --include=*.go --include=*.scm   # 0 hits
```

The only `selector_expression` pattern in `go/tags.scm` is inside the call pattern
(`tags.scm:19-25`): a selector is captured **only** when it sits in a `call_expression`'s `function`
position.

### 1.3 Live proof, not just the code path

Probe: the three Go query files concatenated exactly as `queryFor` concatenates them, compiled
against the linked tree-sitter-go, run over a file holding a named struct with three fields and six
selector uses. Every match, verbatim:

```
match: [definition.type="Container struct { … }"] [name="Container"]
match: [reference.type="Container"] …
match: [definition.function="func use(…)"] [name="use"]
match: [reference.call="boolToInt(f.AutoExplain)"] [name="boolToInt"]
match: [reference.call="c.Greet()"] [name="Greet"]
```

Zero rows for `AutoExplain`, `ThrottlePerSec` or `items` as a definition. Zero rows for
`f.AutoExplain`, `c.AutoExplain`, `f.ThrottlePerSec`, `f.items` as a reference. The grammar's own
shape, from the same probe:

```
(struct_type (field_declaration_list (field_declaration name: (field_identifier) type: …)))
(selector_expression operand: (identifier) field: (field_identifier))
```

### 1.4 Root cause, stated once

**Both halves are missing, and each independently breaks one of the two tools.**

1. **Definition gap.** No query captures `field_declaration`, so a struct field never becomes a
   `symbol` row. `search_symbols` scans `symbol.name` (`codegraph/search.go:38`), so it finds
   nothing. `"field"` is already in `extract.go:64`'s `definitionKinds` closed set — the kind exists,
   nothing has ever produced it.
2. **Reference gap.** A non-call `selector_expression` produces no `reference` row.

`find_references` needs both. `ReferencesTo` (`codegraph/references.go:94-109`) calls `g.locate`,
then `resolveTargets`; with no symbol named `AutoExplain` anywhere, `resolveName`
(`resolve.go:293-299`) returns empty and the tool answers `no references found for "AutoExplain"`.
Even with the definition fixed, `ReferencesTo` would then read
`store.ReferencesByName(repoID, "AutoExplain")` and get zero rows.

This is a different defect class from the two already fixed. C8/P64/P64b were definition-capture
gaps only (the name was captured but never wrapped in a `@definition.x`, so `extract.go:111`'s
prefix switch dropped it; or the pattern could not match a `var ( … )` block at all). P67f/P69b were
reference-capture gaps only, for names that already had definitions. M1c is the first with both
halves missing for the same construct.

### 1.5 Why the reference half cannot reuse `@reference.read`

`resolve.go:355-360`:

```go
if site.Kind == "read" {
    candidates = filterTierAtMost(candidates, 1)
```

A `"read"` reference is clamped to tier ≤ 1 — same file or same directory. P69b added that clamp
deliberately, because a bare identifier carries no qualification evidence.

The failing case is **cross-directory**: the field is declared in `internal/storage/model/`, read in
`internal/storage/repos/` and `internal/connections/` — tier 2. Tagging selector reads `read` would
leave `find_references` answering nothing, exactly as today. `ReferencesTo` keys its memo on
`dir + kind + language` and passes `kind` into the sentinel site (`references.go:246-250`), so the
clamp fires there too.

A selector is not a bare identifier: `f.AutoExplain` names the member explicitly. It needs its own
reference kind, outside that clamp. Hence `@reference.field` (§2.6), not `@reference.read`.

### 1.6 The same gap in TypeScript, TSX and JavaScript — verified, and being fixed

Probed the same way, composing each language's real query set and adding the candidate patterns:

| Language | Member declarations captured today | Non-call member reads captured today |
| --- | --- | --- |
| TypeScript / TSX | none — `typescript/tags.scm:4-8` captures `method_signature` and `abstract_method_signature`, never `property_signature` or `public_field_definition` | none — `javascript/tags.scm:82-85` captures a `member_expression` only in a call's `function` position |
| JavaScript | none — `javascript/tags.scm:1-9` captures `method_definition`, never `field_definition` | same |

Identical defect class, identical shape of fix. P64b's own precedent is exactly this: P64 fixed
TypeScript alone, P64b found and fixed the same class in Go and JavaScript. **Fixing all four
languages here**, not Go alone.

Node kinds confirmed against the linked grammars (they differ, so the files cannot be shared):

- TypeScript/TSX: `(property_signature name: (property_identifier))`,
  `(public_field_definition name: (property_identifier))`.
- JavaScript: `(field_definition property: (property_identifier))` — different node name *and*
  different field name.
- All three: `(member_expression object: … property: (property_identifier))`.

### 1.7 Java, Python and Rust — same gap, declined on payoff

`java/tags.scm` has no `field_declaration` pattern, `python/tags.scm` no `assignment` inside a
`class_definition`, `rust/tags.scm` no `field_declaration`. All three have the identical gap.

Declined here: this repository holds **2 Java, 2 Python and 2 Rust files**, all of them
`internal/codeparse/testdata/extract/` fixtures. No dogfooding session will ever navigate them. A
capture with no user is not worth the golden-table churn.

### 1.8 Measured: what this adds

Counted by running the candidate patterns over the whole worktree (excluding `node_modules`,
`.git`, `build`, `bin`):

| | New `symbol` rows | New `reference` rows |
| --- | --- | --- |
| Go (837 files) | 4,537 | 27,862 |
| TypeScript (778 `.ts` files) | 5,493 | 16,007 |

Reference counts are net of the call-position duplicates §2.6 drops: Go has 60,513
`selector_expression`s of which 32,651 are call-position; TypeScript has 37,410
`member_expression`s of which 21,403 are call-position. The `.vue`/`.svelte` injected blocks (392
files) add more on the TypeScript side, not counted.

Against this repository's current index (`~/.kira-studio/codeindex.db`, this `repo_id`): 18,640
symbols and 174,175 references. So **+54% symbols, +25% references**. The `reference_name` index is
`(repo_id, name)`; the hottest single non-call Go field name is `mu` at 809 rows, then `Kind` 759,
`ID` 756, `Name` 726 — across 2,410 distinct names. Nothing near a scan that needs measuring.

For contrast with the shapes this repository has already priced and declined (`ARCHITECTURE.md`,
the P64b/P67f/P69b paragraph): P67f measured **selector *base* reads** — the `x` in `x.Field` — at
64,652 rows for one position and declined them. M1c captures the **field** half, not the base. The
declined item stays declined.

### 1.9 Cache invalidation is automatic — no user action, full reparse

`codeparse.Fingerprint()` (`fingerprint.go:41-75`) hashes every grammar module version actually
linked, `extractionVersion`, **and every embedded query file's own bytes**, walking
`querySourcePaths`. `codeindex`'s `checkFingerprint` (`sync.go:486-503`) compares it against the
stored `meta.parser_fingerprint` on every sync and, on a mismatch, calls `store.DeleteRepo` before
re-indexing.

So: adding query files and bumping `extractionVersion` both change the fingerprint; every indexed
repository is **truncated and fully reparsed on the next sync after upgrade**, with no manual
deletion and no migration. It does not self-heal incrementally — an incremental update only reparses
changed files, which would leave stale rows for everything else, and that is precisely what the
fingerprint check exists to prevent.

Cost for a real user: one full reindex of each repository they have attached (1,886 files here) on
first launch after the upgrade. Same cost P64/P64b/P67f/P69b each already imposed.

No schema migration. `symbol.kind` and `reference.kind` are plain `TEXT` with no `CHECK`
(`migrations/0001_c1_init.sql`).

### 1.10 One honest limit: `McpEnabled` stays unattributed in `resolved` mode

Two structs in this repository declare a field named `McpEnabled` —
`storage/model/connection.go:30` and `storage/model/coderepos.go:18`, in the same directory. Every
use site is in another directory, so both candidates land at tier 2 and `resolveName` returns
`RepoWide` with 2 ids. `ReferencesTo`'s attribution gate (`references.go:169-172`) keeps a group only
when `conf != RepoWide || len(ids) == 1`, so all 13 sites are counted `unattributed` instead of
returned.

That is not a new defect and not this phase's to fix — it is P69d's deliberate gate, and the caller
gets an actionable message rather than silence (`render.go:89-92`):

> 13 further occurrences of "McpEnabled" could not be attributed to this definition — the name is
> defined in several places and those sites carry no locality evidence; re-call with mode "nameOnly"
> to see them all.

`AutoExplain` and `ThrottlePerSec` are each declared exactly once repository-wide and resolve
fully. §2.9 states each of the three separately; **do not report M1c as done on an `McpEnabled`
resolved-mode result.** Changing the gate would alter resolution for `call`/`type` references
repo-wide and is out of scope (§9).

## 2. The fix

Four new query files, two edits to existing `internal/codeparse` files, no resolver change.

### 2.1 Go — `queries/go/m1c_fields.scm` (new)

```scheme
; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.1) — not vendored.
; The vendored tree-sitter-go tags.scm has no field_declaration pattern, so a struct field is never
; a symbol, and it captures a selector_expression only in a call_expression's function position, so
; a plain `x.Field` read is never a reference. find_references and search_symbols therefore both
; answer nothing for a field reached only through a selector.

; Struct field declarations. Anchored at source_file through a named type_declaration, the same
; choice p64b_declarations.scm makes for const/var: a table test's anonymous
; `[]struct{ name string }{…}` and a function-local type never become symbols. An embedded field has
; no `name` field and is not matched.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            name: (field_identifier) @name) @definition.field)))))

; `x.Field` — Field is used. @definition/@reference sits on the whole selector_expression with @name
; on the field_identifier, so the site's own name range is the field's and a cursor placed on it
; resolves. This also matches the selector inside `c.Greet()`, which tags.scm already captures as
; @reference.call at the identical name range; extract.go drops that duplicate (§2.6).
(selector_expression
  field: (field_identifier) @name) @reference.field
```

`@definition.field` sits on the `field_declaration`, not the `field_declaration_list` — same choice
`p64b_declarations.scm` makes for `const_spec` over `const_declaration`, so each field gets its own
span. Because the span nests inside the `type_spec` the `@definition.type` pattern already captures,
`linkParents` (`extract.go:181`) files each field under its own struct with no extra work.

### 2.2 TypeScript and TSX — `queries/typescript/m1c_members.scm` (new)

```scheme
; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.2) — not vendored.
; typescript/tags.scm captures method_signature and abstract_method_signature but no data member, so
; an interface property, a type-literal property and a class field are all invisible to
; search_symbols and unresolvable by find_references.

; `interface X { a: T }` and `type X = { a: T }` — property_signature is the node in both bodies.
(property_signature
  name: (property_identifier) @name) @definition.field

; `class X { a = 1 }` — TypeScript's own name for javascript's field_definition. A `#private` field
; is deliberately not matched: it is a private_property_identifier, and so is every `this.#a` that
; reads it, so the symbol would have no reachable reference.
(public_field_definition
  name: (property_identifier) @name) @definition.field
```

Registered on TypeScript and TSX. Both already compile `queries/typescript/tags.scm`, so both
grammars carry these node kinds; verified by compiling the full composed query against each.

### 2.3 JavaScript — `queries/javascript/m1c_members.scm` (new)

```scheme
; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.3) — not vendored.
; javascript/tags.scm captures method_definition but not field_definition. JavaScript only: the
; TypeScript grammar renames this node public_field_definition and names the field `name` rather
; than `property`, so one shared file cannot compile against both — typescript/m1c_members.scm
; carries the TS/TSX half. Same split p64b_declarations.scm already lives with.
(field_definition
  property: (property_identifier) @name) @definition.field
```

### 2.4 Shared member read — `queries/javascript/m1c_member_reads.scm` (new)

```scheme
; M1c-authored (docs/v1.7/plans/M1c-repomap-struct-field-fix.md §2.4) — not vendored.
; The same gap as queries/go/m1c_fields.scm one language family over: a member_expression is
; captured only in a call_expression's function position, so `obj.prop` as a value produces no
; reference row. Registered on JavaScript, TypeScript and TSX alike — and so on Vue/Svelte's own
; injected blocks — the same multi-registration javascript/p67f_reads.scm already uses, since
; member_expression and property_identifier are plain syntax all three grammars share.
; A member call matches this too, at the same name range as tags.scm's own @reference.call;
; extract.go drops the duplicate (§2.6).
(member_expression
  property: (property_identifier) @name) @reference.field
```

### 2.5 Registration — `queries.go`

Three edits, all mechanical:

1. `//go:embed` directive (line 11) gains the four paths.
2. `Provenance` gains four `thisRepo` rows, following the P64b/P67f comment shape.
3. `querySourcePaths` (line 84):
   - `JavaScript`: `+ queries/javascript/m1c_members.scm`, `+ queries/javascript/m1c_member_reads.scm`
   - `TypeScript`: `+ queries/typescript/m1c_members.scm`, `+ queries/javascript/m1c_member_reads.scm`
   - `TSX`: `+ queries/typescript/m1c_members.scm`, `+ queries/javascript/m1c_member_reads.scm`
   - `Go`: `+ queries/go/m1c_fields.scm`

`Fingerprint` de-duplicates paths across languages with its own `seen` map, so the shared read file
is hashed once.

### 2.6 `extract.go` — new reference kind, and call-duplicate suppression

Two changes.

**a. `referenceKinds` (line 70) gains `"field": true`.** Without it, `extract.go:148` drops every
`@reference.field` match silently — that closed set is exactly what P64b's plan called out as
"captures need a `definition.`/`reference.` prefix *and* a known kind to produce anything".

**b. Suppress the call duplicate.** `c.Greet()` matches both the call pattern and the new
selector/member pattern. Both produce a `Reference` whose *name* range is the same
`field_identifier`/`property_identifier`; their node spans differ (Go's call pattern spans the whole
`call_expression`, JavaScript's spans the `arguments` node), so the name range is the only correct
dedup key. Verified on both grammars.

Add to `extractSymbols`, immediately before `linkParents(symbols)`:

```go
references = dropCallDuplicateFields(references)
```

and beside it:

```go
// dropCallDuplicateFields removes a "field" reference covering the identical NAME range as a "call"
// reference from the same root. A method call is captured twice by design — tags.scm's own call
// pattern and M1c's selector/member pattern both match `c.Greet()` — and the call is the more
// specific of the two, so find_references lists a call site once rather than twice. Keyed on the
// name range, not the node span: the two patterns' spans deliberately differ.
func dropCallDuplicateFields(references []Reference) []Reference {
	calls := map[[2]int]bool{}
	for _, r := range references {
		if r.Kind == "call" {
			calls[[2]int{r.NameStartByte, r.NameEndByte}] = true
		}
	}
	out := references[:0]
	for _, r := range references {
		if r.Kind == "field" && calls[[2]int{r.NameStartByte, r.NameEndByte}] {
			continue
		}
		out = append(out, r)
	}
	return out
}
```

Filtering in place is safe and intentional — `out` never overtakes the read cursor. Scope is one
`extractSymbols` call, which is one file (`session.go:342`) or one injected block
(`inject.go:160`), so two blocks' byte ranges can never collide.

### 2.7 `fingerprint.go` — `extractionVersion` 3 → 4

Required by that constant's own doc comment (lines 29-33): `referenceKinds` gaining an entry, and
`dropCallDuplicateFields` changing what a parse produces, are exactly the "extraction logic changed
but no query bytes did" case it exists for. The query files change too, so the fingerprint would
move anyway — bump it regardless, so the constant keeps meaning what it says.

### 2.8 No resolver change — and why each candidate was left alone

- **No tier clamp for `"field"`** (`resolve.go:355`). The whole point is cross-directory reach
  (§1.5). A selector names its member explicitly; a bare identifier does not.
- **No `kindCompatibility` entry for `"field"`** (`resolve.go:20`). `kindCompatible` returns `true`
  for an unlisted reference kind, which is the honest answer here: a Go or TypeScript selector's
  target is legitimately a `field`, a `method`, a `constant`, a `variable` or a `function`
  (`time.Second` and `model.DefaultName` are both `selector_expression`s), so an entry would list
  nearly the whole vocabulary and demote nothing.
- **No change to the attribution gate** (`references.go:169`). See §1.10 and §9.

### 2.9 Required results, against the exact cases above

Against a restarted server on a completed reindex of this worktree.

| Call | Today | Required after |
| --- | --- | --- |
| `search_symbols {"query":"AutoExplain"}` | nothing for the field | `field AutoExplain` at `internal/storage/model/connection.go:24` |
| `search_symbols {"query":"ThrottlePerSec"}` | nothing | `field ThrottlePerSec` at `connection.go:27` |
| `search_symbols {"query":"McpEnabled"}` | nothing | two `field` rows: `connection.go:30`, `coderepos.go:18` |
| `find_references {"symbol":"AutoExplain"}` | `no references found` | **7 sites**, all `storage/repos/connections.go` lines 63, 175, 208, 257, 308, 353, 366 |
| `find_references {"symbol":"ThrottlePerSec"}` | `no references found` | **25 sites** across `connections/input.go` (64×2, 67, 68×2), `connections/resolve.go` 54, `connections/service.go` 367, `connections/service_test.go` 733/752/776, `storage/repos/connections.go` 42/175/208/257/308/353/366, `storage/repos/connections_test.go` 24/25/32/36/41/42/55/56 |
| `find_references {"symbol":"McpEnabled"}` | `no references found` | 0 sites + the `13 further occurrences … could not be attributed` note (§1.10); `mode:"nameOnly"` returns all 13 |
| `find_definition` with the cursor on `f.AutoExplain` | no definition | `connection.go:24` |
| `outline_file` on `storage/model/connection.go` | type rows only | each type's fields nested under it |
| `find_references {"symbol":"Greet"}`-shaped method call | one `call` site per call | **unchanged** — no second `field` site at the same position (§2.6) |

## 3. Work order

One Sonnet subagent, sequential, no split point. Four new files of 2-8 lines each plus two small
edits; the only bulky part is regenerating three golden tables, which is mechanical and
order-dependent on the query edits.

1. `queries/go/m1c_fields.scm`, `queries/typescript/m1c_members.scm`,
   `queries/javascript/m1c_members.scm`, `queries/javascript/m1c_member_reads.scm`.
2. `queries.go` — embed, `Provenance`, `querySourcePaths`.
3. `extract.go` — `referenceKinds`, `dropCallDuplicateFields`.
4. `fingerprint.go` — `extractionVersion = 4`.
   Commit 1-4 together: the tree does not compile-and-pass in between (a new capture with no kind
   registered silently drops rows).
5. Fixtures + golden tables (§4). Commit.
6. `codegraph/references_test.go` cross-directory field case (§4.4). Commit.
7. Docs (§6). Commit.
8. Live verification (§7), fixes as follow-up commits.

## 4. Tests

Extend what exists. Do not invent a mechanism.

### 4.1 `TestExtractGoldenFixtures` is the anti-drift guard

`internal/codeparse/extract_test.go:22` already asserts the exact `(kind, name, parent)` and
`(kind, name)` tables per language fixture. P64/P64b/P67f/P69b each extended it and nothing else.
A tree-sitter capture is precisely the "hard to get right, silently regresses" logic
`CLAUDE.md` reserves tests for, so this earns its keep — but as three more fixture blocks, not a new
test file.

### 4.2 `testdata/extract/sample.go` + its golden row

Append an `m1c` block. Prefix every new identifier `m1c`, per the fixture's own existing rule (it is
indexed by the live server; a colliding name makes `find_references` ambiguous against it).

Cover, with the assertion each case exists for:

- Named struct with an exported and an unexported field → two `field` symbol rows, both parented to
  the struct's `type` row.
- Selector reads of both in a function → two `field` reference rows.
- A method call on that struct → exactly one `call` row and **no** `field` row (§2.6).
- A method *value* (`f := v.M`, no call) → one `field` row.
- An anonymous struct inside a function body → **no** `field` symbol rows (the `source_file` anchor).
- A keyed composite literal `T{Exported: true}` → **no** `field` reference row (§8.1).

Two existing rows shift and must not be deleted: `p67fSampleContainer` (`sample.go:57`) gains
`field m` and `field items` symbol rows between its own `type` row and `p67fSampleContainerVal`, and
`p67fSampleContainerVal.items` / `.m` (lines 72, 74) gain `field` reference rows. The existing
comment's claim that they "produce no `read` row at all" stays true and stays put.

### 4.3 `sample.ts` and `sample.js` + their golden rows

Same shape, `m1c`-prefixed:

- `sample.ts`: an interface with two properties, a `type X = { … }` literal with one, a class with a
  public field and a `#private` one, selector reads of each, one method call (no duplicate), and the
  `#private` asserting **no** rows at either end.
- `sample.js`: a class with a `field_definition`, a read of it, a method call.

`sample.py`, `sample.java`, `sample.rs` are untouched — their tables must not move (§1.7). A moved
row there means a pattern is matching something it should not.

### 4.4 One `codegraph` test: a cross-directory `field` reference resolves

`internal/codegraph/references_test.go` already has `seedFile`/`sym`/`ref` helpers and a
directory-scoping test to copy (`TestReferencesToGoUnexportedIsolatesPackages:14`). Add one case:
an exported `field` symbol in `pkg/model/`, a `field` reference to it in `pkg/repos/`, asserting one
site.

This earns its keep — it guards the interaction of three separate rules that no golden fixture
reaches: the `"read"` tier clamp *not* applying to `"field"`, the Go package-privacy clamp, and the
singleton branch of the attribution gate. A future clamp added by kind would otherwise silently
re-break exactly the bug this phase fixes, with every other test still green.

### 4.5 Deliberately no test for

- `queries.go` registration — a missing entry fails §4.2 immediately.
- `extractionVersion` — a constant.
- Fingerprint invalidation — `TestSync_FingerprintMismatchTruncatesRepo`
  (`codeindex/sync_test.go:274`) already covers the mechanism; M1c changes an input to it, not the
  mechanism.

## 5. Dogfooding

Use the repo-map MCP server throughout this phase, per `CLAUDE.md`. Two caveats specific to it:

- The index must be rebuilt before the server answers anything about M1c's own output — restart it
  after the build so `checkFingerprint` fires (§1.9), and wait out the "still building" window (an
  M2-planning entry already logs that it can exceed 60s on this repository).
- Log findings in `docs/v1.7/mcp-repo-map-issues.md`, same rules. Flip the M1ab/M2 struct-field
  entry to **Fixed** with this phase's commit SHAs, in place.

## 6. Documentation

- `docs/ARCHITECTURE.md`, the repo-map paragraph that currently ends "`find_references` now answers
  for every read shape this section names except a selector base and an assignment RHS": add M1c's
  own sentence — fields/members are now definitions, a selector/member *field* read is a `field`
  reference outside the `read` tier clamp, and the previously-declined **selector base** measurement
  stays declined and is a different thing.
- `docs/ARCHITECTURE.md` "Known open items": no entry to add. Add none for §1.10 either — it is
  existing, documented resolver behaviour with its own user-facing message, not a new limitation.
- `queries.go`'s `Provenance` is the authoritative repo-authored query list (ARCHITECTURE.md says
  so); the four new rows are that update.
- No `CLAUDE.md` change. No `docs/DEV_ENVIRONMENT.md` change.

## 7. Verification

Mechanical, from `apps/kira-studio`:

- `go build ./...`, `go vet ./...`, `go test ./...`.
- `bun run mcp:repo-map:build` succeeds (cgo).
- `internal/layering_test.go` passes.

Live, against a restarted server on a completed reindex:

- §2.9's table, every row.
- Per-`repo_id` counts from `codeindex.db`: a new `symbol.kind = 'field'` row count of **4,537 for
  go** and **~5,493 for typescript** (plus whatever the 392 Vue/Svelte blocks add, not predicted
  here), and a new `reference.kind = 'field'` count of **~27,862 for go** and **~16,007 for
  typescript**.
- **The regression check that matters:** go `function`/`method`/`type`/`constant`/`variable` and
  typescript `function`/`interface`/`type`/`class`/`enum`/`constant` symbol counts, and every
  `reference.kind` other than `field`, all **unchanged**. A new pattern that perturbs an existing
  count is matching something it should not. The one intended exception is none — `field` is a new
  kind, so nothing existing should move at all.
- `tools/list` still returns eight tools.

## 8. Considered and declined

### 8.1 Capturing a keyed composite-literal / object-literal key as a field reference — declined

`ConnectionFields{AutoExplain: true}` is a real use site this phase does not reach. In Go it parses
as `(keyed_element key: (literal_element (identifier)))` — **syntactically identical** to a map
literal's own key, `map[Kind]bool{KindA: true}`, where the identifier reads a constant and is not a
field at all. Capturing it would file constant reads under kind `field`. A missing row is better
than a mislabelled one, and P67f already declined `a.b[k]` on the same reasoning ("the name that
would be recorded is not the operand's own").

Same for TypeScript/JavaScript, harder: 25,490 object-literal `pair` keys exist in this repository's
`.ts` files against 5,493 real member declarations. Most are config objects, style objects and test
fixtures. This repository's own domain types are zod schemas (`mcpEnabled: z.boolean()` at
`packages/shared/domain/connection.ts:118`), so this is exactly where capturing `pair` keys would
look tempting — and exactly why it must not be done by syntax alone.

Log the residual gap as a dogfooding note if a session hits it; do not widen this phase.

### 8.2 Relaxing the attribution gate so `McpEnabled` resolves — declined

See §1.10. The gate (`references.go:169`) is P69d's, applies to every reference kind, and relaxing
it would change `call` and `type` resolution repository-wide for a two-candidate case that the
existing `nameOnly` message already answers honestly.

### 8.3 Interface method elements (`method_elem`) — declined, not the same gap

Go's `(interface_type (method_elem name: (field_identifier)))` is uncaptured too. But an interface
method name resolves today anyway, to the concrete `method_declaration` that `tags.scm:13` captures,
so it is not invisible the way a field is. Adding it would also risk a confusing duplicate against
that concrete row. Different problem, no repro, out.

### 8.4 Java, Python, Rust — declined on payoff

§1.7: 6 fixture files between them.

### 8.5 A blanket `field_identifier` reference pattern — already declined upstream of this phase

ARCHITECTURE.md records P64b's, P67f's and P69b's own measurements against capturing every read
position. M1c captures one specific position (the selector's *field*), priced at §1.8. It does not
reopen the selector *base*.

## 9. Out of scope

- Any resolver change (`codegraph/resolve.go`, `references.go`) beyond none.
- Composite-literal / object-literal keys (§8.1).
- Java, Python, Rust (§1.7).
- `find_implementations`' inconsistent `limit` argument (trivial M2-planning entry, still open).
- Everything in M2.

## 10. Files

New:

- `apps/kira-studio/internal/codeparse/queries/go/m1c_fields.scm`
- `apps/kira-studio/internal/codeparse/queries/typescript/m1c_members.scm`
- `apps/kira-studio/internal/codeparse/queries/javascript/m1c_members.scm`
- `apps/kira-studio/internal/codeparse/queries/javascript/m1c_member_reads.scm`

Edited:

- `apps/kira-studio/internal/codeparse/queries.go`
- `apps/kira-studio/internal/codeparse/extract.go`
- `apps/kira-studio/internal/codeparse/fingerprint.go`
- `apps/kira-studio/internal/codeparse/testdata/extract/sample.go`, `sample.ts`, `sample.js`
- `apps/kira-studio/internal/codeparse/extract_test.go`
- `apps/kira-studio/internal/codegraph/references_test.go`
- `docs/ARCHITECTURE.md`
- `docs/v1.7/mcp-repo-map-issues.md`
