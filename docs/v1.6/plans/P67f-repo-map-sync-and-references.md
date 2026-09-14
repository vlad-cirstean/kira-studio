# P67f — Repo-map MCP: surface index sync state, and capture the reference reads Go/TS queries miss

Two mandates (`docs/v1.6/SPEC.md`'s P67f row), both non-trivial dogfooding entries from P67e that
`CLAUDE.md`'s own rule gates P68 on:

1. A query answered against an index that is not whole cannot be told apart from a genuine miss.
2. `find_references` returns nothing for a variable read via `range x` or `x[k]`.

Everything below was read directly, parsed against the pinned grammars' own `node-types.json`,
measured against a live `codeindex.db`, or reproduced against a live server started per
`CLAUDE.md`'s headless steps. Nothing is carried over from the log entries' prose.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Does `internal/codeindex` already track "am I still catching up"? | **No.** Nothing in `codeindex` exposes sync state. `repomap` has a gate, but it is a one-shot `sync.Once` over the *initial* `Sync` only (`server.go:91`, `:260`) | §1.1 |
| Then why did P67e see a confident empty on a cold index? | Not the initial-sync window — that gate works and was re-measured (a query issued at T+0.5s **blocked 3.25s**, then answered correctly). Two other windows are genuinely ungated: a failed initial `Sync` opens the gate anyway, and the watcher's rescan `Sync` runs with the gate already open | §1.2, §1.3 |
| Response field, warning string, or a sync-status tool? | Neither a field nor a new tool. Wait the rebuild out under the bound the gate already uses, and prepend a one-line notice only while the last full sync stands failed. Zero tokens when healthy, no extra round trip, nothing to remember to call first | §2.3, §2.4, §2.5, §9.1 |
| Does the tool output even have a place for a `"stale": true` field? | **No.** `§6.3` fixed the tool output as text only, no structured content (`tools.go:11-16`: `Out` is `any` everywhere, so the SDK emits no output schema). A JSON field would be a new output contract | §9.1 |
| Why does `find_references` miss a `range`/index read? | `queries/go/tags.scm` has exactly **two** reference patterns: `@reference.call` in callee position (lines 19-25) and `(type_identifier) @name @reference.type` (line 30). A plain `identifier` read is captured by neither | §1.4 |
| Is it Go-specific? | **No.** `javascript/tags.scm` and `typescript/tags.scm` have no identifier-read reference pattern either — their only reference captures are `call`, `class` (constructor) and TS `type` | §1.7 |
| What does the fix cost? | **3734** new Go reference rows (936 `range` operands + 2798 index operands), **+2.8%** of the whole 135,496-row reference table. Contrast P64b §8.2's declined every-identifier capture: 257,971 rows, a 2.9x blowup | §1.6 |
| New reference kind, or reuse one? | New: `read`. `referenceKinds` (`extract.go:70`) is a closed set of five and silently ignores an unlisted suffix, so the kind must be added there — which is exactly the case `extractionVersion`'s own doc comment names as requiring a bump | §3.4 |
| Migration? | **No.** `reference.kind` is plain `TEXT NOT NULL` with no CHECK (`migrations/0002_c2_reference_name_range.sql:9`). `Fingerprint` already hashes `extractionVersion` and every query file's bytes, so the rebuild is automatic | §1.8 |
| Unit tests? | Two, both earning their keep under `CLAUDE.md`'s bar: the sync tracker is concurrency (ordering, races), and `TestExtractGoldenFixtures` is the existing anti-drift guard that already asserts reference rows | §5 |

## 1. Confirmed current state

### 1.1 Finding 1 — a gate already exists, and it is one-shot

`repomap.Server` holds `ready chan struct{}` + `readyOnce sync.Once` (`server.go:91-92`). Every one
of the seven tool handlers calls `waitReady` first (`tools.go:85, 127, 174, 217, 278, 310, 331`),
which blocks on `ready` for at most `readyTimeout` (`server.go:32`, 25s) and otherwise returns
`notReadyResult` (`tools.go:27-30`) — an `IsError: true` text result, not an empty one.

`runInitialSync` (`server.go:235-261`) is the only writer of that gate.

Measured against a live server on a genuinely empty `KIRA_HOME`, this container, this tree:

| | |
|---|---|
| `search_symbols {"query":"allowedMethods"}` issued at T+0.5s | **blocked 3.255s**, then returned the correct hit (`gitstream.go:89:5`) |
| Full cold initial sync, 1800-odd files | ~3s (P64c's pipelining; §1.9 of P64b's own plan predicted "under 30s") |

So the *initial*-sync window behaves correctly today and is not where the logged symptom comes from.

### 1.2 Finding 1 — the three windows the gate does not cover

**W1 — a failed or partial initial `Sync` opens the gate anyway.** `runInitialSync`'s own doc
comment states the choice (`server.go:232-234`): "a Sync error still opens the gate (a tool call
then gets whatever codegraph can answer from an empty or partial index, which is honest; it does not
hang forever)". The code matches — `s.readyOnce.Do(func() { close(s.ready) })` at `server.go:260`
runs on both branches of the `if err != nil` above it. The error goes to the server's own stderr
(`server.go:255`) and nowhere a client can see. From then on, every tool answers from a truncated
index with `no symbols matching %q` (`render.go:140`) and `no references found for %q`
(`render.go:84`) — the same strings a real miss produces.

**W2 — every later full `Sync` runs with the gate already open.** `Watcher.fire` calls
`w.idx.Sync(ctx)` directly on a rescan (`watch.go:145-150`). A rescan is the backend's
dropped/overflowed-events signal — a branch switch, a rebase, a large checkout, exactly the "window
right after a large change set lands" the logged entry names. `readyOnce` fired long ago, so nothing
in `repomap` knows this is happening. `Sync` also re-runs `checkFingerprint` (`sync.go:408-426`),
which on a cross-process fingerprint disagreement calls `DeleteRepo` and truncates every row for the
repository before rebuilding.

**W3 — the watcher's per-file writes.** `handleFiring`/`reparseChangedPath`
(`watch.go:160-191, 205-231`) replace or delete one path's rows at a time. A query landing between a
`DeleteFile` and its `ReplaceFile` sees that one file as absent. Real, but one file wide and
milliseconds long — §9.4 declines surfacing it.

W1 and W2 together reproduce the logged symptom exactly, including its strangest detail: confident
empty answers, then correct answers *later with no restart*. A failed initial sync (W1) leaves a
partial index and an open gate; a subsequent ungated `Sync` (W2, or the watcher indexing files as
the session itself edits them) finishes the job, and the identical query starts answering correctly
with nothing having been restarted.

### 1.3 Correction to the logged entry

`docs/v1.6/mcp-repo-map-issues.md`'s P67e (planning) entry says "nothing in `internal/repomap`
exposes a sync/ready state for a tool response to distinguish the two." That is half right and worth
correcting in place when the entry is closed: `repomap` *does* have a readiness gate, it does return
a distinct "still building" message, and it covers the initial sync correctly. What is missing is
that the gate is one-shot and outcome-blind. The fix is therefore not "add a gate" but "make the
existing one continuous and honest about failure" — a much smaller change than the entry implies.

### 1.4 Finding 2 — Go's reference patterns, quoted in full

`queries/go/tags.scm` is 42 lines. Every `@reference` capture in it:

```scheme
(call_expression
  function: [
    (identifier) @name
    (parenthesized_expression (identifier) @name)
    (selector_expression field: (field_identifier) @name)
    (parenthesized_expression (selector_expression field: (field_identifier) @name))
  ]) @reference.call

(type_identifier) @name @reference.type
```

That is all of them. `@reference.call` requires the identifier to sit in a `call_expression`'s
`function` field. `@reference.type` matches any `type_identifier` node anywhere — but Go's grammar
emits `type_identifier` only in type position, never for a value read. A package-level
`var allowedMethods = map[string]struct{}{…}` is an `identifier` everywhere it is read, so:

- `allowedMethods[method]` — an `index_expression`'s `operand`. No pattern.
- `for m := range allowedMethods` — a `range_clause`'s `right`. No pattern.

No reference row is written, so there is nothing for `ReferencesByName` (`references.go:141`) to
return. This is P64/P64b's defect class exactly, moved from the definition side to the reference
side.

`queries/go/p64b_declarations.scm` is untouched by this and stays as it is — it supplies the
*definition* rows (`variable` 354, `constant` 864 live today), which is why `find_definition`
already answers correctly for all four names.

### 1.5 Finding 2 — live reproduction

Against a server built from `64697594` on a completed reindex of this worktree:

```
find_references {"symbol":"allowedMethods"}        -> no references found for "allowedMethods"
find_references {"symbol":"allowedStreamMethods"}  -> no references found for "allowedStreamMethods"
find_references {"symbol":"writeMethods"}          -> no references found for "writeMethods"
find_references {"symbol":"hostAnsweredMethods"}   -> no references found for "hostAnsweredMethods"
find_references {"symbol":"allowedRequest"}        -> 7 references   (control: callee position)
```

All four reproduce. The control confirms the index is warm and the resolver is fine.

### 1.6 Finding 2 — measured cost

Counted with `go/parser` over every `.go` file in the tree (824 files), the same two-independent-
counts discipline P64b §1.4 used:

| position | identifier operand | non-identifier operand |
|---|---|---|
| `range` operand (`ast.RangeStmt.X`) | **936** | 523 |
| index operand (`ast.IndexExpr.X`) | **2798** | 970 |
| selector base (`x.f`) | 64652 | — |
| call argument | 32430 | — |
| assignment RHS | 1687 | — |

Live reference-table baseline, from `codeindex.db` for this repository:

| language | kind | rows |
|---|---|---|
| go | call | 47626 |
| go | type | 37428 |
| typescript | call | 38710 |
| typescript | type | 2823 |
| **total, all languages/kinds** | | **135496** |

So the two Go patterns add **3734** rows: **+4.4%** of Go's own 85,054 reference rows, **+2.8%** of
the whole table. The last three rows of the first table are the reason §9.2 stops at two positions
rather than "every read": selector base alone is 17x the whole fix.

### 1.7 Finding 2 — TypeScript/JavaScript have the same hole

Read directly, every `@reference` capture in the JavaScript/TypeScript family:

```
javascript/tags.scm:78   function: (identifier) @name) @reference.call
javascript/tags.scm:85   arguments: (_) @reference.call
javascript/tags.scm:88   constructor: (_) @name) @reference.class
typescript/tags.scm:20   (type_identifier) @name) @reference.type
typescript/tags.scm:23   constructor: (identifier) @name) @reference.class
```

No identifier-read pattern of any kind. `for (const m of allowedMethods)` and `allowedMethods[m]`
produce no reference row in TypeScript, TSX, JavaScript or Vue either — the same defect, one family
wider.

Magnitude, estimated by `rg` line counts rather than a parse (an order of magnitude is all that is
needed to settle scope; §5 requires the implementer to record the real counts): ~3892 lines carrying
an identifier-subscript and ~537 `for…of` lines across `.ts`/`.tsx`/`.vue`. Same order as Go's 3734.

Cheap, same defect, one rebuild — so §3.3 fixes it here rather than stranding it. P68 is a code
review, not another fix pass; there is no later row to inherit it.

### 1.8 Cache invalidation is automatic, and `extractionVersion` must move

`Fingerprint` (`fingerprint.go:41`) hashes every linked grammar module version, `extractionVersion`,
and every file named in `querySourcePaths`. Two of those three change here, so the next `Sync` after
a rebuilt binary truncates and rebuilds this repository by itself. No migration, no schema change.

`extractionVersion` (`fingerprint.go:33`, currently `2`) must go to `3` regardless: its own doc
comment names this exact change as the reason it exists — "a change like `referenceKinds` gaining a
new entry would alter extraction while leaving the fingerprint identical." The query-file bytes
would already force the rebuild here, but leaving the version behind would break that guarantee for
the next change that touches only Go code.

## 2. The fix — finding 1

### 2.1 Root cause, stated once

`repomap`'s readiness gate is a `sync.Once` over one moment — the initial `Sync` returning, whatever
it returned. It is not a state. A failed initial sync opens it on a partial index; every later full
`Sync` runs behind an already-open gate. `codeindex`, which is where both of those happen, tracks
nothing a reader could consult.

### 2.2 `codeindex` — a sync tracker on `Index`

New, in `internal/codeindex/sync.go` beside `Sync` (not a new file — it is 40 lines and belongs with
the thing it brackets). No library is declined here with a hand-rolled substitute: the mechanism is
a `sync.Mutex`, a counter and a channel from the standard library, which is what any candidate
library would itself be a wrapper over.

```go
// SyncState is one Index's own full-reconcile state (P67f §2.2). A caller that can see it can tell
// "no rows for that name" from "the index is mid-rebuild" or "the last rebuild failed" — which
// nothing outside codeindex could do before.
type SyncState struct {
	InFlight   bool
	Generation uint64    // completed full Syncs; 0 means none has finished yet
	LastErr    error     // the last completed full Sync's own error, nil on success
	LastDoneAt time.Time
}

type syncTracker struct {
	mu       sync.Mutex
	inFlight int
	settled  chan struct{} // closed exactly while inFlight == 0
	gen      uint64
	lastErr  error
	lastDone time.Time
}
```

`Index` gains one field, `sync syncTracker` (`index.go:13-21`), initialized in `Open`
(`index.go:29-38`) with an already-closed `settled` channel — a nil channel blocks forever, which
would be the wrong default for "nothing is running."

`Sync` (`sync.go:48`) brackets itself with two lines and named returns; nothing else in its body
changes:

```go
func (idx *Index) Sync(ctx context.Context) (stats SyncStats, err error) {
	idx.beginSync()
	defer func() { idx.endSync(err) }()
	...
}
```

`beginSync` creates a fresh open `settled` channel when `inFlight` goes 0→1 and increments;
`endSync` decrements, records `err`/`lastDone`, increments `gen`, and closes `settled` when
`inFlight` reaches 0. A counter, not a bool: the initial sync and a watcher rescan can genuinely
overlap (`server.go:168` starts one in a goroutine while `watch.go:146` can start another).

Two accessors:

```go
// SyncSettled returns a channel closed once no full Sync is in flight — already closed when none
// is. Inherently a snapshot: a Sync can begin the instant after it is read.
func (idx *Index) SyncSettled() <-chan struct{}

// SyncState snapshots the last completed full Sync's own outcome.
func (idx *Index) SyncState() SyncState
```

This covers W2 for free — the watcher's rescan goes through the same `Sync`, so it brackets itself
without `watch.go` changing at all.

### 2.3 `repomap` — one bound covering both gates

`waitReady` (`server.go:265-274`) grows a second wait under one shared deadline, so a caller's total
wait stays bounded by `readyTimeout` exactly as today. No handler changes; all seven call sites keep
working unmodified.

```go
func (s *Server) waitReady(ctx context.Context) error {
	deadline := time.After(readyTimeout)
	select {
	case <-s.ready:
	case <-ctx.Done():
		return ctx.Err()
	case <-deadline:
		return fmt.Errorf("repo-map index for %s is still building (initial sync running past %s) — retry shortly", s.root, readyTimeout)
	}
	// P67f §1.2 W2: the gate above is one-shot, so a watcher rescan's full Sync (watch.go's own
	// fire) runs behind an already-open gate. Wait it out under the same bound.
	select {
	case <-s.idx.SyncSettled():
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-deadline:
		return fmt.Errorf("repo-map index for %s is reindexing (running past %s) — retry shortly", s.root, readyTimeout)
	}
}
```

Waiting rather than warning, for the in-flight case: it is what the initial gate already does, it
needs no new response shape, and a rescan finishes in about three seconds on this repository
(§1.1) — well inside the bound a caller already accepts.

### 2.4 `repomap` — the degraded-index notice

W1 cannot be waited out: a failed sync is over. It is surfaced as a one-line prefix, the
repository-level analogue of the per-file `[stale]` marker `source.go:304-320` already stamps — an
established convention here, not a new one.

New, in `tools.go` beside `textResult`:

```go
// indexNotice is P67f §2.4: W1's own surfacing. Empty — the normal case — costs a caller nothing.
func (s *Server) indexNotice() string {
	st := s.idx.SyncState()
	if st.LastErr == nil {
		return ""
	}
	return fmt.Sprintf("index degraded: the last full sync of %s failed (%s); results may be incomplete.", s.root, st.LastErr)
}

// text is textResult with that notice prepended when one stands.
func (s *Server) text(body string) (*mcp.CallToolResult, any, error) {
	if n := s.indexNotice(); n != "" {
		body = n + "\n" + body
	}
	return textResult(body)
}
```

Replace every `textResult(` call site in `tools.go` with `s.text(` — ten of them: `:68`, `:71`,
`:108`, `:164`, `:197`, `:236`, `:257`, `:293`, `:321`, `:345`. `errResult` call sites are left
alone: they carry caller-correctable input errors ("query is required") and `notReadyResult`, which
already says what is wrong.

The notice appears on every response while degraded, not only on empty ones — a partial index
returns *incomplete* non-empty answers too, and those read as complete otherwise. It clears by
itself the moment any later full `Sync` succeeds.

### 2.5 No eighth tool

Decided, not deferred. `conformance_test.go:158` asserts exactly seven tools, `instructions`
(`server.go:187`) and `docs/ARCHITECTURE.md`'s C3 paragraph both describe seven, and a status tool
only helps a caller who remembers to call it *before* trusting a miss. This log's own history says
they will not: P63 and P66 both record calling `outline_file` with the wrong parameter name rather
than reading `tools/list` first. §2.3 and §2.4 need nothing remembered.

### 2.6 What finding 1's fix does not change

- No new tool, no new tool argument, no output schema (`tools.go:11-16` stays text-only).
- No change to `watch.go`, `store.go`, `read.go`, `codegraph`, or any query file.
- No retry policy for a failed sync (§9.3).
- No schema migration; `SyncState` is in-memory, per-process, never persisted.
- `readyTimeout` stays 25s and stays a `var` for the test seam.

## 3. The fix — finding 2

### 3.1 Root cause, stated once

Both query families describe references only where a name is *called*, *constructed* or used as a
*type*. A name that is read as a value is described nowhere, so no row exists for the resolver to
find. Everything downstream is correct: `referenceKinds` is a closed set by design, the writer
stores what it is handed, `ReferencesByName` returns what is stored.

### 3.2 Go — `queries/go/p67f_reads.scm`

New repo-authored file, the split `c2_implements.scm`/`p64_declarations.scm`/`p64b_declarations.scm`
established. Node kinds and field names checked against `tree-sitter-go@v0.25.0`'s own
`node-types.json`: `range_clause` has fields `left` (optional `expression_list`) and `right`
(required `_expression`); `index_expression` has `operand` and `index`, both required `_expression`.

```scheme
; P67f-authored (docs/v1.6/plans/P67f-repo-map-sync-and-references.md §3.2) — not vendored.
; The vendored tree-sitter-go tags.scm captures a reference only in a call_expression's function
; position or as a type_identifier, so a value read — the only way a package-level allowlist map is
; ever used — produces no reference row at all and find_references answers "no references found".
; The capture sits on the identifier itself, the same shape the vendored file already uses for
; `(type_identifier) @name @reference.type`, so the reference's own range and its name range
; coincide and a cursor placed on the name resolves.

; `for k, v := range m` / `for range m` — m is read.
(range_clause
  right: (identifier) @name @reference.read)

; `m[k]` — m is read. A non-identifier operand (`a.b[k]`, `f()[k]`) is deliberately not captured:
; the name that would be recorded is not the operand's own.
(index_expression
  operand: (identifier) @name @reference.read)
```

Facts the implementer should not have to rediscover:

- Go's generic *type* instantiation is `generic_type`, a separate node with `type`/`type_arguments`
  fields — **not** `index_expression` — so the second pattern cannot pollute the index with type
  references. A generic *call* (`Min[int](a, b)`) does parse as a `call_expression` whose `function`
  is an `index_expression`, which the vendored `@reference.call` pattern misses today; this pattern
  picks the name up as a `read`. A small improvement, not a regression — note it, do not chase it.
- Nested subscripts (`m[a][b]`) match once, at the innermost `identifier` operand. Correct: `m` is
  the only name read.
- A `range` over a channel, a function, an integer or a call expression has a non-identifier
  `right` and is not captured. 523 such sites exist here; none of them names a symbol.

### 3.3 JavaScript/TypeScript/TSX — `queries/javascript/p67f_reads.scm`

One file, registered on **JavaScript, TypeScript and TSX**. Checked against
`tree-sitter-javascript@v0.25.0` and `tree-sitter-typescript@v0.23.2` (both the `typescript` and
`tsx` `node-types.json`): all three carry `for_in_statement` (fields `left`, `right`, `operator`,
`kind`, `body`) and `subscript_expression` (fields `object`, `index`, `optional_chain`).

```scheme
; P67f-authored (docs/v1.6/plans/P67f-repo-map-sync-and-references.md §3.3) — not vendored.
; Same gap as queries/go/p67f_reads.scm, one language family over: javascript/tags.scm and
; typescript/tags.scm capture a reference only as a call, a constructor or a type, so a value read
; produces no reference row. Registered on JavaScript, TypeScript and TSX alike — unlike P64b's
; own javascript/p64b_declarations.scm, these patterns exist in no other file, so multi-registration
; duplicates nothing.

; `for (const m of xs)` and `for (const k in xs)` — xs is read either way, so the operator field is
; deliberately not constrained.
(for_in_statement
  right: (identifier) @name @reference.read)

; `xs[k]` — xs is read.
(subscript_expression
  object: (identifier) @name @reference.read)
```

Registration is the same three places P64b §2.2 names, for each of the four entries:

- the `//go:embed` line, `queries.go:11`;
- `querySourcePaths` — `JavaScript` (`queries.go:75`), `TypeScript` (`:76`), `TSX` (`:77`) and `Go`
  (`:78`);
- one `Provenance` row per file with `UpstreamModule: thisRepo` (`queries.go:34-64`).

Vue rides along: an SFC's script block is injected as TypeScript or JavaScript
(`inject.go`'s `resolveScriptLang`), so it uses one of these compiled queries with no separate
registration.

### 3.4 `referenceKinds` and `extractionVersion`

`referenceKinds` (`extract.go:70`) is a closed set of five; `extract.go:148` skips any match whose
suffix is not in it, silently and by design. Add one entry:

```go
var referenceKinds = map[string]bool{
	"call": true, "type": true, "implementation": true, "import": true, "class": true, "read": true,
}
```

Update `Reference.Kind`'s own doc comment (`extract.go:47`) and the schema comment
(`migrations/0002_c2_reference_name_range.sql:9`) — both enumerate the kinds in prose. Editing an
already-applied migration's comment is safe here, checked rather than assumed: `migrate` applies a
step only when `m.Version > current` and records the version number (`migrate.go:52-73`), with no
checksum over the SQL text anywhere in the package.

Bump `extractionVersion` (`fingerprint.go:33`) from `2` to `3`.

Without a `kindCompatibility` entry (§3.5), `read` renders as the kind word in `find_references`
output (`render.go:100-103`) — `gitstream.go:146:12   read   in ServeGitStream` — which is more
informative than folding it into `call`.

### 3.5 `kindCompatibility` — deliberately untouched

`kindCompatible` (`resolve.go:27-34`) returns `true` for a reference kind with no table entry, so a
`read` reference demotes nothing and ranking is byte-identical to today's for every existing row.
Adding `"read": {"variable": true, "constant": true, "field": true}` would be a defensible ranking
improvement and is **not** done here: this phase's mandate is to stop a silent wrong answer, not to
re-rank the resolver, and `kindCompatibility` is a demotion table whose every existing entry was
tuned against measured cases. P64b §2.8 made the same call for `constant`/`variable`. Recorded as
§10's OQ3 rather than smuggled.

### 3.6 Required results, against the exact cases logged

Rebuild, restart, let the fingerprint-driven reindex finish, then:

| Call | Required result |
|---|---|
| `find_references {"symbol":"allowedMethods"}` | 3 references: `gitstream.go:146`, `gitstream_test.go:60`, `gitstream_classification_coverage_test.go:42` |
| `find_references {"symbol":"allowedStreamMethods"}` | at least `gitstream.go:190` and `gitstream_classification_coverage_test.go:45` |
| `find_references {"symbol":"writeMethods"}` | non-empty; the `range` reads in `gitstream_test.go` and `gitstream_classification_coverage_test.go` |
| `find_references {"symbol":"hostAnsweredMethods"}` | non-empty, same two files |
| `find_references {"symbol":"allowedRequest"}` | **still exactly 7**, all kind `call` — the control, and the regression check |
| `find_references {"symbol":"allowedMethods","kinds":["read"]}` | the same set as the unfiltered call |
| `find_definition {"symbol":"allowedMethods"}` | unchanged: 1 definition, `gitstream.go:89:5`, kind `variable` |
| `find_references` on a TypeScript name read only via `for…of`/subscript | non-empty (pick one at implementation time and record which) |
| `outline_file` on any file | unchanged node counts — this phase adds no definitions |

Line numbers above are the ones the P67e log recorded; re-read `gitstream.go` before asserting them,
since this plan does not re-verify them and the file has been edited since.

## 4. Work order

One Sonnet subagent, sequential. The two findings are independent and could in principle run in
parallel, but both end in one rebuild-reindex-verify cycle against one live server on one port, so
splitting them costs more than it saves. Each step's own fast checks (`go build ./...`,
`go vet ./...`) run per commit; the full `go test ./...` and the live pass run once at the end, per
`CLAUDE.md`.

1. `codeindex`: `SyncState`/`syncTracker`/`beginSync`/`endSync`/`SyncSettled`, the `Index` field and
   its `Open` initialization, and `Sync`'s two-line bracket (§2.2). Extend
   `sync_concurrency_test.go` (§5.1). **Gate:** `go test ./internal/codeindex/...`.
   Commit: `feat(codeindex): track full-sync state so a reader can tell mid-rebuild from empty`.
2. `repomap`: `waitReady`'s second wait (§2.3), `indexNotice`/`s.text` and the ten call-site swaps
   (§2.4). Extend `repomap`'s own readiness test (§5.2).
   **Gate:** `go test ./internal/repomap/...`.
   Commit: `fix(repomap): wait out a rescan and say so when the last sync failed`.
3. `queries/go/p67f_reads.scm` + registration in all three places; `referenceKinds` gains `read`;
   `extractionVersion` 2→3; doc-comment updates (§3.2, §3.4). Extend
   `testdata/extract/sample.go` and `extract_test.go`'s Go golden rows (§5.3).
   **Gate:** `go test ./internal/codeparse/...`.
   Commit: `fix(repomap): index Go range and index-expression reads as references`.
4. `queries/javascript/p67f_reads.scm` + registration on JavaScript, TypeScript and TSX (§3.3).
   Extend `testdata/extract/sample.js` and `sample.ts` and their golden rows.
   **Gate:** `go test ./internal/codeparse/...`.
   **Stop gate:** record the real new-row counts per language from the rebuilt index (§8). If the
   TypeScript family gains more than 10,000 reference rows, or any *existing* kind's count moves at
   all, stop and leave step 4 out rather than shipping it — a moved existing count means a pattern
   is matching something it should not.
   Commit: `fix(repomap): index JavaScript and TypeScript value reads as references`.
5. Rebuild `kira-repo-map`, restart, let the reindex finish, run §3.6 in full plus §8's live checks
   and §6's dogfooding.
6. Docs (§7) and the two log entries closed in place (§6).
   Commit: `docs(repomap): P67f — sync-state surfacing and reference-read coverage`.

## 5. Tests

`CLAUDE.md`'s bar is a test only for genuinely hard logic. Two qualify; nothing else gets one.

### 5.1 `codeindex/sync_concurrency_test.go` — the tracker

Concurrency is explicitly on `CLAUDE.md`'s list (ordering, races), and this is a counter plus a
channel that two goroutines touch. The existing file already runs concurrent `Sync` calls, so the
harness is there. Assert:

- with no `Sync` running, `SyncSettled()` is already closed and `SyncState().InFlight` is false;
- during a `Sync`, `SyncSettled()` is open, and it closes when the `Sync` returns;
- two overlapping `Sync` calls leave `SyncSettled()` open until the **second** finishes — the
  counter, not a bool;
- a `Sync` that returns an error records it in `LastErr`, and a later successful `Sync` clears it;
- `Generation` increments once per completed `Sync`.

Run it under `-race`.

### 5.2 `repomap` — the second wait

One case added to the existing readiness test (`index_test.go`, which already lowers `readyTimeout`
for exactly this): with the initial gate open and a full `Sync` in flight, a tool call blocks rather
than answering, and returns the "reindexing" message once the lowered bound elapses. One case, not a
matrix — the first wait's own behavior is already covered.

### 5.3 `codeparse/extract_test.go` — golden rows

`TestExtractGoldenFixtures` already asserts `refs []refRow` alongside symbols, which makes it the
existing anti-drift guard for exactly this change. Extend the fixtures; add no new test.

`sample.go` — verified clean of any `range` or subscript today, so the golden rows gain only what is
added:

- a `range` over a package-level identifier — asserts one `read` row;
- an index read of a package-level identifier — asserts one `read` row;
- a `range` over a call expression or a `.field` — asserts **no** row (non-identifier operand);
- an index read whose operand is a selector (`x.m[k]`) — asserts **no** row;
- a nested subscript (`m[a][b]`) — asserts exactly one row, for `m`.

`sample.ts` and `sample.js` — one `for…of` over an identifier and one subscript read each, plus one
`for…of` over a call expression asserting no row.

### Deliberately no test for

The `queries.go` registration (three list literals; a missing entry fails the golden test or the
build), `Provenance` (a documentation table with no behaviour), the `extractionVersion` bump
(already covered by `TestSync_FingerprintMismatchTruncatesRepo`, `sync_test.go:274`), the
`indexNotice` string itself (a two-branch format call), and anything in `codegraph` — untouched.

## 6. Dogfooding

Per `CLAUDE.md`'s "Repo-map MCP server" and `docs/v1.6/mcp-repo-map-issues.md`'s own header.

**From this planning session, to transcribe** under the trivial section. This pass found **no new
non-trivial issue** — both findings under investigation are the phase's own subject, and nothing
else answered wrongly:

- **P67f (planning)** — no server was running at session start (`ConnectionRefused` for the native
  tool surface, expected). Built and started per the headless steps. Two notes worth recording.
  First, `pgrep -f "kira-repo-map|mcp-repo-map.ts" | xargs kill` kills the calling shell (exit 144)
  for the same reason `pkill -f` does, already logged twice (P63, P67): the pattern matches the
  agent harness's own command line. `ps -eo pid,comm | awk '$2=="kira-repo-map"'` does not. Second,
  pointing `KIRA_HOME` at "the scratchpad directory" is **not** reliably a cold index — this
  session's scratchpad already held a `codeindex.db` from an earlier agent under the same session
  id. Use a fresh subdirectory (`mkdir -p "$SCRATCH/coldhome"`) when a cold index is actually the
  point.
- **P67f (planning)** — tool answers were correct on every call except the phase's own subject.
  `search_symbols {"query":"allowedMethods"}` resolved to `gitstream.go:89:5` (kind `variable`) even
  when issued 0.5s after a cold start — the call blocked 3.255s on the readiness gate and then
  answered correctly, which is the gate working as designed and is recorded in the plan as a
  correction to the P67e (planning) entry's own root-cause guess.

**Both non-trivial entries are closed in place by this phase**, per the log's own "closed in place
(status flips to Fixed, commit noted) rather than deleted" rule — with §1.3's correction written
into the cold-index entry rather than left implying the fix added a gate that already existed.

**For the implementing session.** Navigate with the server throughout. After step 5, run at least:
`find_references` on all four `*Methods` variables and on `allowedRequest`; `find_references` with
`{"kinds":["read"]}` and with `{"kinds":["call"]}` on the same name; one TypeScript name read only
via `for…of`; `find_definition` and `outline_file` on a file this phase did not touch, as a
no-regression check. Log whatever that finds under the trivial/non-trivial split — a non-trivial
finding in P67f's own new surface is logged and **not** fixed in P67f.

Two setup notes not to rediscover: the server must be **rebuilt** before dogfooding or it serves the
old query set, and the first `Sync` after that rebuild reindexes the whole repository (§1.8).

## 7. Documentation to update

- **`docs/ARCHITECTURE.md`, the C3 paragraph** — still seven tools, no count change. Two clauses
  worth adding: a tool call waits out a full reindex under a 25s bound and says "reindexing" past
  it; a response carries a one-line `index degraded:` prefix while the last full sync stands failed.
- **`docs/ARCHITECTURE.md`, wherever reference kinds are enumerated** — `read` joins
  `call`/`type`/`implementation`/`import`/`class`. Check for P64b's own added clause about Go
  constants having no reference rows: it stays true for a *constant read in a non-range,
  non-subscript position*, but is now too broad as written. Narrow it rather than delete it.
- **`CLAUDE.md`** — no change. No new tool, no new process rule.
- **`docs/DEV_ENVIRONMENT.md`** — no change expected; check its repo-map section for a query-file
  list before assuming so.
- **Known open items** — nothing opens. If P67f lands without step 4 (§4's stop gate), open one
  entry for the TypeScript/JavaScript half and nothing else.

## 8. Verification

Mechanical, from `apps/kira-studio`:

- `go build ./...`, `go vet ./...`, `go test ./...`, and `go test -race ./internal/codeindex/...`.
- `bun run mcp:repo-map:build` succeeds (cgo).
- `internal/layering_test.go` still passes — `repomap` must keep importing nothing from
  `internal/bridge`, and this phase adds only a `codeindex` call it already makes.

Live, against a restarted server on a completed reindex:

- §3.6's table, every row.
- `tools/list` still returns **seven** tools.
- Reference-row counts from `codeindex.db` for this `repo_id`, against the §1.6 baseline:
  go `call` **unchanged at 47626**, go `type` **unchanged at 37428**, go `read` **3734 ± the drift
  from any edit since this plan was written**. A moved existing count is the real regression signal.
- TypeScript/JavaScript/Vue `call`/`type`/`class` counts **unchanged**; their `read` counts recorded
  as the actual measured numbers (§1.7's figures are `rg` estimates and are not an assertion).
- Symbol counts unchanged across the board: go `function` 4245, `method` 1838, `type` 1287,
  `constant` 864, `variable` 354. This phase adds no definitions.
- A query issued immediately after a cold start still blocks and then answers correctly, not
  an empty result (the §1.1 measurement, re-run).

## 9. Considered and declined

### 9.1 A `"stale": true` field on every response — declined

`§6.3` fixed the tool output as text with no structured content: every handler's `Out` type is
`any`, so the SDK emits no output schema at all (`tools.go:11-16`). A JSON field would mean a new
output contract for all seven tools, a schema change every existing client would have to learn, and
a second rendering path beside `render.go`. The one-line text prefix reaches the same reader for the
same cost and fits the surface that exists. Revisit only if the tool output ever gains structured
content for an unrelated reason.

### 9.2 Capturing every Go identifier read — declined, with the number

The general shape of "a variable is read" also covers a selector base (`x.f`), a call argument, an
assignment RHS, a composite-literal element and a return value. Measured (§1.6): selector base
64,652 and call arguments 32,430, against this fix's 3,734. That is P64b §8.2's declined 2.9x
blowup arriving by a different road, and it would make `find_references` on any common short name
(`err`, `ctx`, `row`) useless. `range` and index operands are where a *named collection* is
consulted, which is the question the log's own repro asks. Stop there.

### 9.3 Retrying a failed initial sync — declined

Tempting, since W1 is a failure that never repairs itself on its own. But a retry policy is real new
behavior — how many attempts, what backoff, what cancels it, what happens when the watcher's own
rescan races it — and it is a different question from "does the caller find out." The watcher's
rescan path already re-runs a full `Sync` on the next overflow, and §2.4 makes the degraded state
visible until one succeeds. If a retry is wanted, it is its own row with its own plan.

### 9.4 Surfacing the per-file watcher window (W3) — declined

`reparseChangedPath` deletes and rewrites one path's rows (`watch.go:205-231`); a query landing in
between sees that file as symbol-free. One file wide, milliseconds long, and bracketing every
per-file write in the tracker would leave `SyncSettled()` flapping open and closed under normal
editing — turning §2.3's wait into a stall for a window narrower than the round trip that observes
it. The full-`Sync` bracket is the right granularity.

### 9.5 Making `SyncState` persist in `meta` — declined

`last_full_sync_at` already lands in `meta` (`sync.go:99-102`), so persisting looks free. It is not
the same thing: the question §2.4 answers is "did *this process's* last reconcile fail," which a
timestamp cannot say and which a second process sharing the same `codeindex.db` would answer wrongly
for the first. In-memory, per-`Index`, per-process is the correct scope.

### 9.6 Editing the vendored `tags.scm` files — declined

Same reason P64b §8.3 gives: a vendored row in `Provenance` claims the file is upstream's text
verbatim. New repo-authored files keep that claim true and keep the whole fix additive.

## 10. Open questions

**OQ1 — wait out an in-flight rescan, or answer immediately with a warning?**
*Recommendation: wait* (§2.3). It matches what the initial gate already does, needs no new response
shape, and a rescan costs about three seconds here. The cost is a caller occasionally blocking for
up to 25s on a repository being rebuilt — which is strictly better than a confident wrong answer,
and is the trade §4.2 already made.

**OQ2 — is the JavaScript/TypeScript half in scope?**
*Recommendation: yes* (§3.3), behind §4's stop gate. Same defect, same rebuild, measured the same
order of magnitude, and P68 is a review with no later fix row to inherit it. The gate means an
implementer who measures something unexpected leaves it out rather than shipping noise.

**OQ3 — add a `"read"` entry to `kindCompatibility`?**
*Recommendation: no* (§3.5). The unknown-kind default already makes ranking identical to today's,
and re-ranking the resolver is not this phase's mandate. Worth its own look if a later phase finds a
`read` reference resolving to the wrong same-named symbol — record that case if one appears.

**OQ4 — should the degraded notice appear on every response, or only on empty ones?**
*Recommendation: every response while degraded* (§2.4). A partial index returns incomplete non-empty
answers too, and those are the ones that read as complete. The notice is empty in the healthy case,
so the cost is zero exactly when it does not matter.

*(A fifth question — whether the migration comment at `0002_c2_reference_name_range.sql:9` is safe
to edit — was resolved during this pass rather than left open: `migrate.go:52-73` gates each step on
its version number alone and checksums nothing, so the comment edit is safe. §3.4 states it.)*

## 11. Out of scope

- Every language other than Go, JavaScript, TypeScript and TSX. Python, Java and Rust have their own
  reference-pattern gaps (`python/tags.scm` captures only `@reference.call`); this repository has 1
  Python file and 1 Rust file, so no measurement here would say anything about them.
- Any new definition kind, any new symbol. This phase adds reference rows only.
- Any `codegraph` change — no ranking change, no new resolver rule, no `kindCompatibility` entry.
- A retry policy for a failed sync (§9.3), and per-file watcher-window surfacing (§9.4).
- An eighth tool, a new tool argument, and structured tool output (§2.5, §9.1).
- The Settings dialog's Code intelligence tab. Product surface; neither fix needs UI.
- The P64-era entries in `docs/v1.6/mcp-repo-map-issues.md` already marked Fixed or Resolved.

## 12. Files

New:

- `apps/kira-studio/internal/codeparse/queries/go/p67f_reads.scm`
- `apps/kira-studio/internal/codeparse/queries/javascript/p67f_reads.scm`

Changed:

- `codeindex/index.go` — one `Index` field, its `Open` initialization
- `codeindex/sync.go` — `SyncState`, `syncTracker`, `beginSync`/`endSync`/`SyncSettled`/`SyncState`,
  and `Sync`'s two-line bracket at `:48`
- `codeindex/sync_concurrency_test.go` — §5.1's cases
- `repomap/server.go` — `waitReady` (`:265-274`)
- `repomap/tools.go` — `indexNotice`/`s.text`, and ten `textResult(` call sites
- `repomap/index_test.go` — §5.2's one case
- `codeparse/extract.go` — `referenceKinds` (`:70`), `Reference.Kind`'s doc comment (`:47`)
- `codeparse/fingerprint.go` — `extractionVersion` 2→3 (`:33`)
- `codeparse/queries.go` — `//go:embed` line (`:11`), `querySourcePaths` for `JavaScript`,
  `TypeScript`, `TSX` and `Go`, two `Provenance` rows
- `codeparse/testdata/extract/sample.go`, `sample.ts`, `sample.js` — §5.3's fixture lines
- `codeparse/extract_test.go` — the Go, TypeScript and JavaScript golden `refs` rows
- `codeindex/migrations/0002_c2_reference_name_range.sql` — the kind-list comment only (safe, §3.4)

Docs: `docs/ARCHITECTURE.md` (§7), `docs/v1.6/mcp-repo-map-issues.md` (both non-trivial entries
closed in place with §1.3's correction, plus §6's two trivial entries and whatever implementation
finds).
