# P69b — `find_references`: a bare identifier read as an argument or operand

Plan for SPEC row P69b. Closes the non-trivial dogfooding finding in
`docs/v1.6/mcp-repo-map-issues.md` ("P69 (code review, round 2)"). Small phase: two query files, one
resolver fix, golden-fixture rows.

Written against HEAD `13b9d107`, branch `v1.6`. Every number below is measured on this worktree's
own index, not estimated.

## 1. Problem

`find_references` answers "no references found" for a package-level constant or variable read as a
plain identifier in argument position, or as a binary-expression operand. Reproduced live on all six
names the finding lists, against a warm current index:

| `find_references {"symbol": …}` | Answer |
| --- | --- |
| `readyTimeout` | `no references found` |
| `syncLockPollInterval` | `no references found` |
| `watchDebounce` | `no references found` |
| `maxFileBytes` | `no references found` |
| `sourceLineMaxBytes` | `no references found` |
| `PREVIEW_ROW_LIMIT` | `no references found` |

`find_definition` and `search_symbols` resolve every one. The gap is capture, not resolution.

P67f's `queries/go/p67f_reads.scm` captures two shapes — `(range_clause right: (identifier))` and
`(index_expression operand: (identifier))` — and `queries/javascript/p67f_reads.scm` the
`for_in_statement`/`subscript_expression` equivalents. Argument and operand position is neither.

## 2. Confirmed current state

- `codeparse/queries/go/p67f_reads.scm`, `codeparse/queries/javascript/p67f_reads.scm` — the two
  patterns each, exactly as above. The JS file is registered for `JavaScript`, `TypeScript` and
  `TSX` (`queries.go:87-89`); the Go file for `Go` (`queries.go:90`).
- `codeparse/extract.go:70` `referenceKinds` already contains `"read"`. **This phase adds no new
  kind**, so `extractionVersion` (`fingerprint.go:33`, currently 3) does **not** move. `Fingerprint`
  hashes every embedded query file's own bytes (`fingerprint.go:59-71`), so editing a `.scm` alone
  changes the fingerprint and forces the truncate-and-rebuild. Verified during this pass: a probe
  edit to the two `.scm` files, with `extractionVersion` untouched, triggered a full repo reparse.
  The finding's own suggested "bump `extractionVersion`" is therefore unnecessary — noted because the
  finding says otherwise.
- `codeparse/extract.go:146-170` — a `@reference.x` capture needs a sibling `@name`; the row's kind
  is the capture suffix. Rows dedupe on `(kind, name, startByte, endByte)`, so a node captured by
  two patterns stores once.
- Grammar node names, read from the vendored `node-types.json` rather than recalled:
  `tree-sitter-go@v0.25.0` has `argument_list` (unnamed children, no field), `binary_expression`
  (`left`/`right`), `slice_expression` (`operand`/`start`/`end`/`capacity`).
  `tree-sitter-javascript@v0.25.0` has `arguments` (children `expression`/`spread_element`, no
  field) and `binary_expression` (`left`/`right`).
- Go's `nil`, `true` and `false` are their own grammar nodes, not `identifier`, so they are never
  captured. This matters: `go/ast` counts them as `*ast.Ident` and would overstate the cost by
  ~8,500 rows.

## 3. The row-count question, measured

This is the phase's real decision, and the SPEC row gates shipping on it.

Method: add the candidate captures to both `.scm` files as a throwaway probe, rebuild, let the
server do its forced full reparse, count rows in `codeindex.db` scoped to this repo's own
`repo_id`, then revert. (The shared `codeindex.db` holds four worktrees; an unscoped count is
3.6x too large and was the first thing this pass got wrong.)

### 3.1 Size and throughput — acceptable

| Metric (repo `/home/user/kira-studio`, 1,876 files, 18,521 symbols) | Baseline | With capture | Delta |
| --- | --- | --- | --- |
| `read` rows | 5,261 | 67,475 | **+62,214** |
| all reference rows | 141,973 | 204,187 | **+43.8%** |
| `call` / `type` / `class` / `implementation` rows | 93,788 / 41,221 / 1,632 / 71 | identical | **0** |
| index bytes in use (`dbstat`, all four worktrees) | 93.54 MB | 101.10 MB | **+7.55 MB** |
| `find_references` latency, worst common name (`path`, 589 hits) | — | **34 ms** | — |

New `read` rows by language: go 46,653, typescript 17,755, vue 2,899, javascript 166.

Independent cross-check with `go/parser` over 829 Go files, the two-counts discipline P64b §1.4 and
P67f §1.6 both used: 32,692 bare identifiers in call-argument position and 19,475 in
binary-operand position, 52,167 total — which reconciles with the 46,653 measured once `nil`
(8,474 occurrences), `true`, `false` and `_` are removed, as §2 says they are.

For scale: P64b §8.2 declined capturing *every* identifier at 257,971 rows, a 2.9x blowup of the
whole table. This capture is 0.44x, touches no existing kind, costs 7.55 MB, and leaves query
latency flat. On size and throughput alone it clears P67f's own stop gate ("any existing kind's
count moves at all" — none moved).

### 3.2 Precision — *not* acceptable without §4.2, and §4.2 is not the obvious fix

Size was never the real problem. Two measurements on the probe index:

1. **45,322 of the 62,214 new rows (73%) carry a name that matches no symbol of any kind anywhere
   in the index.** They are unreachable dead weight — 4,212 of 6,142 distinct `read` names.
2. The remaining 27% collide with real symbol names, and the collisions are *returned*:

   `find_references {"symbol":"path"}` answered **589 references** (405 Go, 146 TypeScript, 38
   Vue). The only symbol named `path` in the entire repository is a `const path` inside
   `packages/git-ui/src/components/dialogs/WorktreeDialog.vue`. Every Go hit is an unrelated local
   variable. Baseline answer for the same call: 2 rows.

The first hypothesis was that `resolve.go:349`'s Go package-privacy rule —

```go
if site.File.Language == "go" && isUnexportedGoName(name) {
```

— was simply unreachable from `ReferencesTo`, because `groupResolutionTargets`
(`references.go:225-226`) builds its synthetic site as `codeindex.FileRow{Path: dir + "/\x00"}`
with `Language` left zero, so `site.File.Language` is never `"go"`. That is true, and it is a real
latent defect (§4.3). **It is not sufficient.** Measured on a second probe build carrying that fix:

| `find_references` | Baseline | Capture only | Capture + language fix | Capture + §4.2 |
| --- | --- | --- | --- | --- |
| `path` | 2 | 589 | 184 | **0** |
| `id` | — | 375 | 375 | **2** |
| `dir`, `out` | — | noisy | 0 | 0 |

The language fix clears the Go half and leaves the JavaScript family untouched, because that family
has no package-privacy rule at all: a module-level name is visible repo-wide at tier 2. The residual
184 `path` hits are TypeScript locals in `apps/kira-studio-vscode/` resolving to
`const path = ref('')` inside `packages/git-ui/…/WorktreeDialog.vue`. Unambiguously wrong.

So the shippable rule has to be language-independent. The one that works, and the one §4.2 adopts:
**a `read` reference resolves only within tier ≤ 1** (same file or same directory). The evidence
that this is the right rule rather than a blunt one:

- **All six repro names are already tier ≤ 1.** A package-level constant is consulted inside its own
  package; that is what makes it package-level. Nothing this phase exists to fix is lost — verified,
  all six still answer identically under §4.2 (§6.1a).
- P67f's and P67e's own verified read cases are tier 0 and still answer correctly under it:
  `EXTENSION_LANGUAGE` (1 hit), `EnumNamesRedisType` (1 hit), `allowedMethods` (3 hits).
- A bare identifier carries no import or qualification evidence, so a name-based resolver genuinely
  cannot tell a local from a distant module-level constant. Tier ≤ 1 is the honest limit of what the
  index can support for this kind, and it makes the existing Go rule a special case of a general one
  rather than a second ad-hoc rule.
- Cost: a genuinely cross-directory read of an exported constant no longer resolves. For
  argument/operand positions that read was never answerable at all before this phase, so this
  narrows a new capability rather than removing an existing one.

**Call: ship the capture with §4.2.** Size and throughput were never the blocker; precision was.

## 4. Fix

### 4.1 The captures

Append to `queries/go/p67f_reads.scm`:

```scheme
; `f(x)` — x is read. argument_list has no field name; a non-identifier argument (a call, a
; selector, a composite literal) is not captured, same rule as the two patterns above.
(argument_list (identifier) @name @reference.read)

; `a < b`, `a + b` — both operands are read. Comparison and arithmetic share one node kind, so the
; operator is deliberately not constrained.
(binary_expression left: (identifier) @name @reference.read)
(binary_expression right: (identifier) @name @reference.read)

; `raw[:n]` — n is read. start/end/capacity only; `operand` is already covered by index_expression
; above for the non-slice form and is captured here for the slice form too.
(slice_expression start: (identifier) @name @reference.read)
(slice_expression end: (identifier) @name @reference.read)
(slice_expression capacity: (identifier) @name @reference.read)
(slice_expression operand: (identifier) @name @reference.read)
```

Append to `queries/javascript/p67f_reads.scm`:

```scheme
; `f(x)` — x is read. The JavaScript grammar's node is `arguments`, not `argument_list`.
(arguments (identifier) @name @reference.read)

; `a < b`, `a + b` — both operands are read.
(binary_expression left: (identifier) @name @reference.read)
(binary_expression right: (identifier) @name @reference.read)
```

No JS slice equivalent exists; the language has no slice-expression node.

`slice_expression` is included because it costs **659 rows repo-wide** (425 operands + 234
start/end/capacity, 0.46% of the table) and closes `source.go:159` (`raw[:sourceLineMaxBytes]`), a
read site the finding lists explicitly and which the argument/operand patterns alone do not reach.

**Deliberately still uncaptured**, measured, and named here so a later round does not re-log them
blind: `return` operand (3,505), composite-literal value (~3,810), unary operand (2,307), index
position (1,514), assignment RHS (1,099), selector base (64,652 — 17x the whole fix, the same
reason P67f §1.6 stopped where it did). None appears in this finding's repro.

No change to `queries.go`: both files are already registered for every language that needs them.
No change to `extract.go`, `referenceKinds` or `extractionVersion` (§2).

### 4.2 Resolve a `read` reference only within its own scope

In `resolveName` (`resolve.go`), immediately before the existing Go package-privacy block:

```go
if site.Kind == "read" {
	candidates = filterTierAtMost(candidates, 1)
	if len(candidates) == 0 {
		return nil, "", nil
	}
}
```

`filterTierAtMost` (`resolve.go:213`) already exists and is already used for exactly this shape.

`ReferencesTo` must then feed the reference's own kind into the resolution memo, which today has no
kind dimension on purpose. Three changes in `references.go`:

- `groupResolutionTargets` gains a `kind` parameter and sets it on the sentinel site:
  `resolveSite{File: sentinel, Kind: kind, …}`.
- Its one caller (`references.go:159-164`) passes `r.Kind`.
- The memo key widens from `dir` to `dir + "\x00" + r.Kind`.

**Update the comment block at `references.go:155-158` and on `groupResolutionTargets`.** Both
currently assert that "tier membership never depends on the reference's own kind (only ranking
does)", which is precisely what this change stops being true. A stale comment here is worse than
none — it is the justification for the memo key's own shape.

### 4.3 Also set the sentinel's language — separable, recommended

Independently of §4.2, the Go package-privacy rule at `resolve.go:349` is inert for **every**
`ReferencesTo` call, including `call` and `type` references this phase does not touch, because the
sentinel's `Language` is never set:

```go
sentinel := codeindex.FileRow{Path: dir + "/\x00", Language: language}
```

Same caller passes `rf.Language`; memo key widens by language as well as kind (a directory can hold
both `.go` and `.ts` files). `TestReferencesToGoUnexportedIsolatesPackages` (`references_test.go:14`)
does not cover this — both its packages declare their own `helper`, so tier-1 preference decides the
case and the Go rule is never consulted.

Found while planning, not by calling the shipped server (on today's index the symptom is invisible:
2 rows named `path`), so it is recorded here rather than opened as a new dogfooding entry — the same
handling P64's plan gave its own wider-than-logged discovery. §4.2 makes it unnecessary for `read`
rows, but it is six lines, it is verified to leave the existing `codegraph` suite green, and leaving
a known-inert correctness rule in the same function this phase is already editing is worse than
fixing it. Recommend including it; the phase is still correct without it.

## 5. Commits

Conventional Commits, three, in order:

1. `fix(repomap): resolve read references within their own file or directory` — §4.2 and §4.3, plus
   the `codegraph` regression tests (§6.2). Lands first: it is the precondition. Landing it before
   the capture is a strict improvement and leaves no intermediate state where the index carries the
   new rows without the rule that keeps them honest.
2. `fix(repomap): index bare-identifier argument and operand reads as references` — both `.scm`
   files (§4.1) and the golden-fixture rows (§6.2). One commit, not one per language: the two files
   are one change, and splitting them would leave an intermediate state whose measured row counts
   match neither §3.1 column.
3. `docs(P69b): close the bare-identifier read finding` — both doc updates in §7, written after
   §6.1's live verification so the numbers recorded are the ones actually measured on the shipped
   build, not this plan's probe.

## 6. Verification

### 6.1 Live, against a rebuilt server

Rebuild (`bun run mcp:repo-map:build`), restart, wait out the forced full reparse, then:

**a. The six names must resolve to their real read sites.** Expected sites, at HEAD `13b9d107`
(the finding's own line numbers predate two commits; these are current):

| Name | Must include |
| --- | --- |
| `readyTimeout` | `repomap/instance.go:137`, `:150`, `:152`, `:165`, `:212` |
| `syncLockPollInterval` | `codeindex/synclock_unix.go:79` |
| `watchDebounce` | `codeindex/watch.go:117` |
| `maxFileBytes` | `codeindex/sync.go:446`, `:453` |
| `sourceLineMaxBytes` | `repomap/source.go:85`, `:86`, `:158`, **`:159`** (the `slice_expression` site), plus `source_test.go:49`, `:60`, `:61`, `:76` |
| `PREVIEW_ROW_LIMIT` | `frontend/src/views/grid/fkPreview.ts:83`, `:94` |

Every one of these counts was confirmed against a probe build carrying §4.1 + §4.2 during this
planning pass, so they are expected values, not hopes.

**b. Precision must not regress.** Expected, all measured on that same probe build:

| Call | Expected |
| --- | --- |
| `path` | `no references found` |
| `id` | 2 |
| `dir`, `out` | `no references found` |
| `name`, `page`, `row` | unchanged ambiguous-symbol prompt, not a reference list |

**c. P67f's and P67e's own read cases must still answer.** These guard §4.2 against over-reach and
all three were verified green on the probe build: `EXTENSION_LANGUAGE` in
`views/repo/language.ts` → 1 hit at `:246`; `EnumNamesRedisType` in `page/wire/RedisType.go` →
1 hit at `:40`; `allowedMethods` → 3 hits across `bridge/gitstream*.go`.

**d. Row counts must land within §3.1's bound.** Stop gate, from `codeindex.db` scoped to this
repo's own `repo_id` (the shared DB holds four worktrees — an unscoped count is 3.6x too large):
`read` rows ≤ **70,000** (probe measured **68,135** with the `slice_expression` patterns included),
total reference rows ≤ **210,000** (probe: **204,847**), and `call`, `type`, `class` and
`implementation` each **exactly** unchanged at 93,788 / 41,221 / 1,632 / 71. Any movement in an
existing kind means a pattern is capturing something it should not — stop and diagnose rather than
re-baselining.

Full-reparse wall time is not a gate: measured 248 s baseline vs 259 s with the capture on this
container, **+4.4%**, because parse dominates and `insertRef`'s share (P64c §1.4) rides on top of it.

### 6.2 Tests

Two, both in existing suites — no new test file.

- `codeparse/extract_test.go`'s `TestExtractGoldenFixtures` is the existing anti-drift guard for
  reference rows and is where P67f put its own coverage. Extend `testdata/extract/sample.go`,
  `sample.ts` and `sample.js` and their golden `refs` rows, keeping P67f's naming discipline (a
  `p69b`-prefixed identifier that collides with nothing real, since these fixtures are indexed
  alongside the repository). Cover, per language: an identifier passed as a call argument (one
  row); both operands of a comparison (two rows); a non-identifier argument such as a call or a
  selector (**no** row); and, Go only, `x[:n]` (one row for `n`).

  Note, confirmed by running the test against this plan's probe build: the **existing** `sample.js`
  and `sample.ts` golden rows also move, because P67f's own fixtures already contain
  `console.log(v)` and a `name` read that the new argument pattern now captures — four extra rows
  across the two files (`read name:v` twice, `read name:name` twice). `sample.go` is clean today and
  gains only what is deliberately added. Update the JS/TS golden tables for the incidental rows as
  well as the new cases; a diff that only adds the new cases will still fail.
- `codegraph/references_test.go` gains one case: a `read` reference to a name whose only declaration
  sits in an unrelated directory, in a **non-Go** language, asserting `ReferencesTo` returns nothing,
  and a sibling assertion that the same name declared in the referring file's own directory still
  resolves. Non-Go is the point — it is the half `TestReferencesToGoUnexportedIsolatesPackages`
  cannot reach and the half §4.3 alone does not fix. This clears CLAUDE.md's bar: it guards
  interacting tier/kind/language rules, and the memo key's new kind dimension, not a CRUD
  round-trip.

No test for the `.scm` registration (unchanged) or for §4.3 on its own (the existing suite already
covers the Go path, and was verified green with the change applied).

## 7. Doc updates

- `docs/v1.6/mcp-repo-map-issues.md` — flip the P69 Non-trivial entry to
  `Fixed (<sha of commit 2>)` and append a `**Fix (P69b, …)**:` paragraph, the format the P68b
  entry already uses. State what was captured, the measured row growth, and that the resolver fix
  rode along because the capture is unshippable without it. Record the `path` 2 → 589 → 0 sequence:
  it is the whole argument in one line.
- `docs/ARCHITECTURE.md:987-1003` — the paragraph beginning "**P64b's Go package-level
  `const`/`var` …**" is now wrong in three specific places and must be rewritten, not appended to:
  it names "a call argument" and "an assignment RHS" as shapes that return empty "by construction";
  it says `find_references` is "still structurally empty for every other read shape"; and its
  declined-measurement list needs this phase's own numbers (§3.1) beside P64b's 2.9x and P67f's
  selector-base 64,652. Selector base and assignment RHS stay genuinely uncaptured (§4.1), so the
  rewrite narrows the claim rather than deleting it. No "Known open items" entry opens or closes.

## 8. Out of scope

The five uncaptured positions listed in §4.1; the 73% dead-row fraction measured in §3.2 (a
name-based index stores unreachable names by design, and pruning them needs cross-file knowledge
`extractSymbols` does not have — the rows cost 7.55 MB and resolve to nothing, which §4.2 makes
harmless); an import-aware resolver for the JavaScript family, which is what would let a
cross-directory `read` resolve again; and any change to `ReferencesTo`'s ranking, limits or output
format.

Also deliberately not done: a scope-aware capture that drops locally-bound identifiers at extraction
time. It was considered as the alternative to §4.2 and declined — it needs a per-language binding
walk (Go receivers, named results, short var decls, range and type-switch bindings, closures; JS/TS
destructuring, hoisting, catch params) that is far more code than §4.2's four lines, and §4.2 solves
the same problem at query time with rules the resolver already has.
