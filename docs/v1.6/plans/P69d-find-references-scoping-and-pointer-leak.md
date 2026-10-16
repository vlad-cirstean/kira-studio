# P69d — `find_references` file/line scoping; `go-tree-sitter` pointer-registry leak

Two independent non-trivial dogfooding findings from P69c's own planning pass, both logged in
`docs/v1.6/mcp-repo-map-issues.md`, both gating P70. Different files, different root causes, one
Sonnet implementation pass.

- **Part A** — `find_references`'s `file`/`line` disambiguator does not scope results.
  Six facets, all root-caused to `internal/repomap`/`internal/codegraph`. Fixable, fixed, measured.
- **Part B** — `go-tree-sitter@v0.25.0` leaks one `go-pointer` registry entry per
  `ParseWithOptions` call. Investigated for real, **not fixable in our own code**; lands as a
  `docs/ARCHITECTURE.md` known open item with measured magnitude, not a forced fix.

Part A's commits touch only `codegraph`/`repomap`/`codeparse`'s language vocabulary. Part B touches
no code at all. They do not interact; land A first, then B's doc commits.

Everything below marked *measured* was run live during this planning pass against a probe build of
the exact design, on a warm index of this worktree at HEAD `c808a75c` (1,878 indexed files). The
probe was reverted before this plan was committed — no application code is changed by this commit.

## Part A — `find_references` scoping

### A.1 Problem

`file` (with or without `line`) is the documented disambiguator, and the exact remedy
`renderAmbiguous` tells a caller to add (`render.go:272`: *"re-call with file or languages set to
one of these"*). It neither preserves a correct answer nor narrows a wrong one.

Reproduced live this pass, on a freshly started server:

| Call | Answer | Correct |
| --- | --- | --- |
| `find_references {"symbol":"Forget"}` | **2** | yes (grep agrees: `codeindex/sync.go:172`, `codeindex/watch.go:240`) |
| same + `"file":"…/codeparse/session.go","line":102` | **`no references found`** | no — line 102 *is* `Forget`'s own definition |
| same + `"line":102,"column":19` | **2** | yes — only the exact byte column works |
| `{"symbol":"Parse","file":"…/session.go","line":199}` | **38**, led by `flag.Parse()`, `url.Parse()`, `time.Parse()` | no — 8 of 38 are `(*Session).Parse` |
| `{"symbol":"Close"}` | **25** candidates | no — the index holds **35** symbols named exactly `Close` |
| `{"symbol":"Close","languages":["go"]}` | **35** candidates | yes — a filter that *widens* its own result |
| `{"symbol":"Close","languages":["Go"]}` | `no references found` | no — silently case-sensitive |
| `find_definition {"file":"…/session.go","line":199}` | `no definitions found for ""` | no |
| `find_references {…,"mode":"name_only"}` | **13** (silently `resolved`) | no — the schema documents `name_only`; only `nameOnly` works, which gives **43** |

The `Parse` count moved 38 → 34 unrelated + 4 sites since P69c's line numbers; `Parse`'s definition
is now `session.go:199`, not `:194`. Line numbers below are current at `c808a75c`.

### A.2 Root causes

Six facets, three distinct bugs plus three argument-handling defects. Each located precisely.

**A2-a — `file`+`line` drops the symbol name, then misses on a defaulted column.**
`repomap/locator.go:105-116`. The inner `switch` makes `line` and `symbol` *mutually exclusive*:
the `args.Line > 0` arm sets `q.Point` and never sets `q.Name`. It also defaults `Column` to 1
(0-based 0). `codegraph/position.go:66-90`'s `resolveHit` then runs `symbolByNamePoint` /
`referenceByNamePoint`, both of which require the column to land *inside* an identifier's own name
span. On `func (s *Session) Forget(path string) {`, `Forget`'s `NameStartColumn` is 18 — column 0 is
whitespace inside `func`. Neither lookup hits; `q.Name` is empty, so `resolveHit`'s
`if q.Name != ""` fallback (line 86) cannot fire either, and it returns `queryHit{}` with
`Ok: false`. `ReferencesTo` (`references.go:99-101`) returns an empty `Refs`.

So the disambiguator fails in the only shape a caller naturally has: a `path:line` copied out of an
ambiguity list, with no byte column.

**A2-b — `resolved` mode does not actually resolve; it degenerates to `nameOnly`.**
`references.go:103` and `:234` both discard the `Confidence` that `resolveName` returns
(`cands, _, err :=`). At tier 2, `resolveName` (`resolve.go:369-384`) deliberately returns *every*
same-named symbol in the repository as a **demoted, never dropped** candidate — that is §5.4 rule 1's
stated design, and correct for `DefinitionOf`, which ranks and shows them. `ReferencesTo` then uses
the same set as a *membership test* (`references.go:168-173`): a reference is attributed to the
query's target if the target appears anywhere in the group's candidate set.

At `RepoWide` that test is vacuously true. `Parse` has exactly 2 exact definitions
(`codeparse/session.go:199`, `postman/parse.go:38`). A `flag.Parse()` call in
`cmd/kira-repo-map/main.go` resolves to a group whose candidates are both of them at tier 2 — so
`(*Session).Parse` is "in the set", and the site is attributed. Every reference to any name with at
least one definition anywhere passes. `resolved`'s documented contract ("precise — runs the
resolver") is false for every repo-wide-ambiguous name, and it returns the identical list `nameOnly`
would.

Second-order: `maxCandidates = 16` (`resolve.go:14`) truncates the tier-2 set arbitrarily, so today
the membership test is also non-deterministic for a name with more than 16 definitions — the target
may or may not survive the cut.

**A2-c — a `languages` filter widens because the limit is applied before the exact filter.**
`locator.go:120` runs `SearchSymbols` — a **prefix** search — capped at `defaultSymbolLocateLimit`
(50), and `exactSymbolMatches` (`locator.go:84-92`, case-**sensitive** `h.Name == name`) filters
*after* that cap. Two mismatches compound:

- SQLite's `LIKE` is **case-insensitive** for ASCII by default, so `Close%` also matches `close*`.
- `search.go`'s `less` ranks a case-**insensitive** exact match top
  (`aLower == needle`), so 49 lowercase `close` symbols compete with 35 `Close` symbols for the same
  50 slots, and 10 `Close` rows are cut before `exactSymbolMatches` ever sees them.

Restricting to `go` removes 44 of those competitors, so all 35 fit. *Measured*: the index holds
35 symbols named exactly `Close` and 84 named `close` case-insensitively (5 Go `close`,
22 TypeScript, 21 Vue, 1 JavaScript). Simulating the exact pipeline (SQL `LIKE 'Close%'`
`ORDER BY name, path, start_byte LIMIT 250` → `less` → truncate 50 → case-sensitive filter)
reproduces **25** unfiltered and **35** with `languages:["go"]` — the live numbers exactly. The SQL
window is not the cut (143 rows < 250); the Go-side `limit` is.

**A2-d — `languages` is silently case-sensitive and unvalidated.**
`codeindex/read.go:279-284` builds `f.language IN (…)` against a vocabulary stored lowercase
(`codeparse.ID`'s twelve constants). Nothing normalizes or validates, anywhere in the chain, so
`"Go"`, `"GO"` and `"golang"` each return a wrong answer (`no references found`) instead of an
error.

**A2-e — `no definitions found for ""`.** Same root as A2-a: nothing resolves, so `q.Name` is empty
and `render.go:60` interpolates it. The message names no file, no line, and no plausible next step.

**A2-f — `mode` documents a value it does not accept.** `tools.go:162`'s jsonschema says
`'resolved' … or 'name_only'`; `tools.go:188` compares against `string(codegraph.NameOnly)` ==
`"nameOnly"`. `"name_only"` — and every other unrecognized value — silently falls back to
`resolved`. *Measured*: `"nameOnly"` → 43, `"name_only"` → 13, `"zzz"` → silently resolved.

Found this pass while verifying A2-b's own remedy message, which directs the caller to exactly this
parameter. Same defect class as A2-d (a documented argument value silently ignored, producing a
wrong answer rather than an error), same tool, same function, two lines — folded into this phase
rather than logged as another gated phase.

### A.3 How the fix composes with P69b

P69b (`fa4ab77b`, `752ffb83`) made reference *capture* broader (bare-identifier reads) and then
clamped the resolver to keep precision: `resolve.go:355-360` drops a `read`-kind reference to tier
≤ 1, and `references.go:159` joins `kind` and `language` to the memo key so that clamp and the Go
package-privacy rule are reachable from `ReferencesTo` at all.

Part A does not touch either. A2-b adds a gate *after* `resolveName` returns — it reads the
`Confidence` that function already computes and already discards. A `read` reference is clamped to
tier ≤ 1 before `bestTier` is taken, so it never reaches `RepoWide` and the new gate never fires on
it. P69b's own six read cases and its three precision guards are re-run unchanged in §A.6 and were
all green on the probe.

### A.4 The fix

#### Commit 1 — `fix(repomap): resolve a file+line locator that has no byte column`

Covers A2-a and A2-e.

- `repomap/locator.go`: set `q.Name = args.Symbol` on the `Query` **unconditionally** in the
  `args.File != ""` branch, before the inner `switch`; drop the now-empty `case args.Symbol != "":`
  body (the `default:` arm still rejects `file` with neither).
- `codegraph/position.go`: add `symbolOnRow` / `referenceOnRow` and extend `resolveHit`'s
  `q.Point != nil` arm to fall through to them when both point lookups miss. Each scans for
  `NameStartRow == q.Point.Row`, additionally requiring `Name == q.Name` when `q.Name` is set, and
  takes the smallest `NameStartByte` (leftmost) among matches. Symbols before references, the same
  precedence and for the same reason as the existing point path.
- `repomap/tools.go`: `findDefinition` currently echoes the *requested* position as
  `resolved from …:199:1`. When the row fallback fired, echo the resolved target's own name span
  instead, so the header does not report a column the resolver ignored.

A defaulted column is what makes the fallback the common path; a caller who passes a real column
that hits is unaffected. A caller who passes a real column that *misses* now gets the named symbol
on that line instead of silence — strictly better, and pinned by name whenever `symbol` is given.

#### Commit 2 — `fix(codegraph): stop attributing a repo-wide-ambiguous reference to one definition`

Covers A2-b.

- `groupResolutionTargets` returns `(map[int64]bool, Confidence, error)` — it already has the
  confidence from `resolveName` and throws it away.
- `ReferencesTo` memoizes `{ids, discriminant}` per `(directory, kind, language)`, where
  `discriminant = conf != RepoWide || len(ids) == 1`. A group that is *not* discriminant carries no
  locality evidence at all: attribute nothing to it, and count the occurrence into a new
  `Refs.Unattributed`.
- `Refs` gains `Unattributed int`; `renderReferences` prints one closing line when it is non-zero:

  > `25 further occurrence(s) of "Parse" could not be attributed to this definition — the name is
  > defined in several places and those sites carry no locality evidence; re-call with mode
  > "nameOnly" to see them all.`

  Also rendered on the `total == 0` path, so an all-unattributed answer is never a bare
  `no references found`.

The singleton exception is what preserves recall for the ordinary cross-directory case: `Forget` has
exactly one definition repository-wide, so its group resolves `RepoWide` with one candidate, stays
discriminant, and both its cross-package call sites are kept. *Measured*: `Forget` unchanged at 2.

This is a deliberate precision/recall trade, and it is the trade the tool already documents.
`nameOnly` exists precisely for "every reference sharing the name, grep-shaped recall over
precision"; `resolved` promises precision and currently returns `nameOnly`'s own answer. Making
`resolved` discriminating restores the documented difference between the two modes rather than
removing a capability — and the note plus Commit 4's `mode` fix make the recall path one call away
and correctly spelled. It also makes `maxCandidates`' arbitrary 16-row cut stop mattering: a group
large enough to be truncated is never discriminant.

#### Commit 3 — `fix(repomap): resolve a symbol-alone lookup by exact name, not a truncated prefix search`

Covers A2-c.

- `codegraph`: add `SymbolsNamed(ctx, name string, languages []string, limit int) ([]Target, error)`
  — `store.FindSymbolsByName` (already `WHERE repo_id = ? AND name = ?`, exact, case-sensitive, on
  `symbol_name`'s own index; already used by `resolveName`) plus `FilesByIDs`, a Go-side language
  filter, `containerChain`, ordered by path then start byte. No new SQL.
- `repomap/locator.go`: the symbol-alone arm calls `SymbolsNamed` instead of `SearchSymbols` +
  `exactSymbolMatches`. Delete `exactSymbolMatches` — it becomes dead.

`SearchSymbols` is unchanged; `search_symbols` keeps its prefix/substring behaviour, which is what
that tool is for. Only the *locator*'s disambiguation lookup changes, and only to stop asking a
ranked prefix search a question it cannot answer without truncating the answer.

#### Commit 4 — `fix(repomap): validate the languages and mode arguments instead of ignoring them`

Covers A2-d and A2-f.

- `codeparse`: add `KnownIDs() []ID` returning the twelve constants in a stable order — one
  vocabulary, so no other package hand-copies the list.
- `repomap/locator.go`: `normalizeLanguages` lower-cases and trims each value and rejects an unknown
  one as a caller-correctable `locateResult.msg`:
  `unknown language "golang" — languages must be one of: css, go, html, java, javascript, json, python, rust, svelte, tsx, typescript, vue`.
  Called at the top of `locate`, so every tool embedding `locatorFields` gets it.
- `repomap/tools.go`: accept `name_only` and `nameOnly` (and `resolved`) for `mode`; reject anything
  else with an `errResult` naming the accepted values. Fix the jsonschema text to name both
  spellings.

`search_symbols` has its own `Languages` field on the same `SymbolSearch` path; route it through
`normalizeLanguages` too rather than leaving one tool validating and its sibling not.

#### Commit 5 — `test(codegraph): cover the confidence gate and the row-scoped locator fallback`

Two tests, in the existing `references_test.go` and `position_test.go`. Per `CLAUDE.md`'s bar, only
these two earn their keep:

- the attribution gate — three interacting conditions (`Confidence` × candidate count × `RefMode`)
  whose regression is silent in both directions (over-match returns a plausible wrong list;
  over-filter returns a plausible short one);
- `resolveHit`'s point-then-row-then-name precedence — a boundary rule with four outcomes and an
  off-by-one column at its centre.

Nothing else here gets a test: `SymbolsNamed` is a thin exact-name read, and the language/mode
checks are enum guards, both of which `CLAUDE.md` names explicitly as earning nothing.

### A.5 Measured expected values

Every row below was produced by a probe build of the design above, against a warm index of this
worktree. These are measured outcomes, not targets.

| Call | Before | After |
| --- | --- | --- |
| `{"symbol":"Forget","file":"…/session.go","line":102}` | `no references found` | **2** (`sync.go:172`, `watch.go:240`) |
| `{"symbol":"Forget"}` | 2 | **2** |
| `{"symbol":"Parse","file":"…/session.go","line":199}` | 38, led by `flag.Parse` | **13**, all in `internal/codeparse`, plus the unattributed note (**25**) |
| same, `"mode":"nameOnly"` | 43 | **43** |
| `{"symbol":"Close"}` | 25 candidates | **35** candidates |
| `{"symbol":"Close","languages":["go"]}` | 35 candidates | **35** candidates |
| `{"symbol":"Close","languages":["Go"]}` | `no references found` | **35** candidates |
| `{"symbol":"Close","languages":["golang"]}` | `no references found` | `unknown language "golang" — …` |
| `find_definition {"file":"…/session.go","line":199}` | `no definitions found for ""` | **1 definition**, `method Parse  exact  self` |
| `{"symbol":"Parse",…,"mode":"name_only"}` | 13 (silently resolved) | **43** |

`Parse`'s 13 are 8 real `(*Session).Parse` sites plus 5 `parser.Parse(…)` calls on tree-sitter's own
`Parser` — same package, so a name-based resolver genuinely cannot separate them without type
information. Precision on that call goes 8/38 → 8/13. Stating that plainly is the point: the
remaining 5 are C2's documented name-resolution limit, not a surviving defect.

Latency after the change, *measured*: ~20 ms for both the `Close` ambiguity list and the `Parse`
resolved list. `SymbolsNamed` replaces a 250-row `LIKE` scan with an indexed equality read, so the
locator path is strictly cheaper; the attribution gate adds no work beyond returning a value
`resolveName` already computes.

### A.6 Regression guards

All of these were green on the probe build. Any movement means stop and diagnose, not re-baseline.

**P69b's six read cases** — `readyTimeout` **5**, `syncLockPollInterval` **1**, `watchDebounce`
**1**, `maxFileBytes` **2**, `sourceLineMaxBytes` **8**, `PREVIEW_ROW_LIMIT` **2**.

**P69b's precision guards** — `path`, `dir`, `out` → `no references found`; `id` → **2**;
`name`/`page`/`row` → the ambiguous-symbol prompt, not a reference list (now **10** / **4** / **11**
candidates: A2-c's fix means these are exact-name counts, so a change here is expected and is the
fix working, not a regression).

**P67f's and P67e's read cases** — `EXTENSION_LANGUAGE` **1**, `EnumNamesRedisType` **1**,
`allowedMethods` **3**. Plus P67f's `pick` in `repomap/attach.go` → **11**, and `runInitialSync`
→ **1**.

**P68b** — `outline_file` on a nonexistent path still answers
`no indexed file at … and no such file on disk`, distinct from `has no indexed definitions`.

**P64** — `read_symbol {"symbol":"Forget","file":"…/session.go"}` returns the declaration's bytes.

**Go suites** — `go test ./apps/kira-studio/internal/codegraph/... ./apps/kira-studio/internal/repomap/...`
passed **unchanged** on the probe, before Commit 5's own tests were written. No existing test
encodes any of the six broken behaviours, so none needs updating.

**Index row counts are not a gate here.** Part A changes only how indexed rows are *read*; no query
file, no `extractionVersion`, no capture. No reparse is required and none of P69b's row-count bounds
can move.

## Part B — `go-tree-sitter`'s per-parse pointer-registry leak

### B.1 The leak is real, and exactly as logged

Read directly out of the pinned module, not inferred. In
`go-tree-sitter@v0.25.0/parser.go:319-361`, `ParseWithOptions` saves the input payload and
`defer`s its release correctly (`:332-333`), then at `:350` does
`payload: pointer.Save(options)` inside the `if options != nil` block with **no matching `Unref`
anywhere in the package**. Five such sites, zero releases: `parser.go:350`, `:477`, `:548`, `:631`,
`query.go:788`.

`mattn/go-pointer@v0.0.1` is 50 lines: `Save` does `C.malloc(1)` and inserts into a package-global
`map[unsafe.Pointer]interface{}` behind a global `sync.RWMutex`; `Restore` takes the read lock;
`Unref` deletes and frees. `Save(nil)` returns `nil` with no allocation and no entry.

`codeparse/session.go:295-312`'s `parseWithOptions` passes a fresh `&sitter.ParseOptions{…}` on
every call, and after P69c that is every parse this codebase does. So: one `C.malloc(1)` plus one
permanent map entry per parse.

No newer version exists. *Verified this pass* against `proxy.golang.org`: the published list is
`v0.23.0`, `v0.23.1`, `v0.24.0`, `v0.25.0` and nothing else.

### B.2 The proposed workaround cannot bound the registry

The pooled/shared-`ParseOptions` idea fails on one line of `go-pointer`:

```go
var ptr unsafe.Pointer = C.malloc(C.size_t(1))
...
store[ptr] = v
```

`Save` mints a **fresh** key per call and never deduplicates by value. Passing the *same*
`*ParseOptions` pointer 10,000 times produces 10,000 malloc'd keys and 10,000 map entries. Reuse
bounds the retained *Go objects*; it cannot bound the registry, which is what actually grows.

*Measured* — 20,000 parses of a 3-line Go source, `HeapAlloc`/`HeapObjects` after two forced GCs,
plus `VmRSS`:

| `options` | Go heap | Heap objects | RSS |
| --- | --- | --- | --- |
| fresh per call (today) | **+75.6 B/parse** | **+2.00/parse** | +239.2 B/parse |
| one shared struct, reused | **+43.7 B/parse** | **+0.00/parse** | +147.3 B/parse |
| `nil` | **0 B/parse** (−112 B total) | **0** | — |

So the best case for the workaround removes 42% of the Go-heap growth and leaves it **still
unbounded** — 43.7 B/parse is the `map[unsafe.Pointer]interface{}` bucket growth alone, with the
`C.malloc(1)` chunks on top. The `nil` row is the only one that stops the leak, and it stops it
completely.

### B.3 What the workaround would cost

`ProgressCallback` is structurally per-call. `parserProgressCallback` (`parser.go:284-290`) restores
`*ParseOptions` from `state.payload` on every progress tick, so the entry must be live for the whole
parse. The exported callback receives only `ParseState{CurrentByteOffset, HasError}` — no parser
identity, no call identity. A single process-wide shared options struct can therefore only consult
process-global state, and `Session` parses concurrently: one cancelled context would abort every
in-flight parse. Making it correct means one options struct *per pooled parser*, with each parse's
cancellation state published to and cleared from an atomic on that parser.

That is a rewrite of the per-parse cancellation handoff — the exact machinery P69c stabilised three
commits ago (`84fb06f8`, `d2fab09f`, `71ac6d04`) after two separate crash modes. Spending that risk
to remove 42% of a leak that remains unbounded either way is the wrong trade, and `CLAUDE.md`'s own
"skip a measurement that wouldn't change the decision" cuts the same way for the fix itself.

### B.4 The other two options, and why they are worse

**Pass `options: nil`.** Zero leak, *measured*. It also removes the only mid-parse cancellation
mechanism this codebase has. P69's own investigation established that the deprecated
`ParseCtx`/cancellation-flag path is a guaranteed nil-pointer SIGSEGV (the flag pointer is NULL
unless `ts_parser_set_cancellation_flag` was called), which is why `ProgressCallback` is used at
all. P69c's `ctx.Err()` pre-checks guard only *before* a parse starts. Dropping options would make
a large-file parse unabortable — a Settings revoke or app quit would block on it. Not acceptable.

**`SetCancellationFlag`.** It exists (`parser.go:752`) and is registry-free. But it stores a Go
pointer (`*uintptr`) in C memory that outlives the call — the precise cgo pointer-passing rule
`go-pointer` exists to work around — needs a watcher goroutine per parse (what P69 removed), needs a
fresh flag per parse plus an explicit clear because the flag is sticky, and reaches the identical
`ts_parser__check_progress` abandon path, so it reopens P69c's own crash surface without closing the
leak's cause. Strictly worse than the leak.

**Vendor or `replace` the library.** The upstream fix is one `defer pointer.Unref(…)` per site, and
it is provably safe (no callback can fire after `ts_parser_parse_with_options` returns). But
`go-tree-sitter` ships tree-sitter's whole C runtime in-tree, so vendoring means copying and then
owning that C source here — against `CLAUDE.md`'s library-reuse-first rule, and it blocks the real
fix when v0.26 lands. `ParseCtx` is already marked *"will be removed in 0.26"*, so this file is
actively being reworked upstream. Too large a decision for this phase to make unilaterally.

### B.5 Magnitude, measured — the original estimate was high

The finding estimated "10^4-10^5 permanently retained entries per full repository index". The real
figure is **one entry per file parsed**: this repository indexes **1,878 files**, so a full index
leaks **1,878 entries ≈ 0.14 MiB of Go heap / 0.43 MiB RSS**. The entries accumulate across
re-indexes and watcher reparses over a process lifetime, so the growth is genuinely unbounded — but
it is roughly two orders of magnitude smaller per index than logged, and the issues-doc entry should
be corrected to say so rather than closed on a number this pass disproved.

One further correction: `codeindex/sync.go:412` passes one context for a whole sync, so the retained
closures capture **one** `context.Context`, not one per parse. The "retains the caller's ctx" alarm
in the original entry overstates it — the measured 2.00 objects/parse are the `ParseOptions` struct
and the closure header, pointing at a shared context.

### B.6 Verdict

Investigated, not fixable within this phase's scope at a defensible risk. Record it, do not force it.

#### Commit 6 — `docs(ARCHITECTURE): record go-tree-sitter's per-parse pointer-registry leak`

Add to `docs/ARCHITECTURE.md`'s **Known open items**, after the `codegraph.ImplementationsOf` entry:

> - **Every parse leaks one `go-pointer` registry entry** (P69d). `go-tree-sitter@v0.25.0`'s
>   `ParseWithOptions` saves its `*ParseOptions` into `mattn/go-pointer`'s package-global map
>   (`parser.go:350`, and `:477`/`:548`/`:631`/`query.go:788`) with no matching `Unref` anywhere in
>   the package — an upstream bug, and v0.25.0 is the newest published version, so there is nothing
>   to upgrade to. `codeparse.Session` passes options on every parse (it is the only mid-parse
>   cancellation mechanism the library offers that does not SIGSEGV), so each parse permanently
>   retains one `C.malloc(1)` and one map entry: measured **75.6 B of Go heap and 239 B of RSS per
>   parse**, ≈ 0.43 MiB of RSS for one full index of this repository's 1,878 files, growing across
>   re-indexes for a process's lifetime. Not fixable in our own code: `pointer.Save` mints a fresh
>   key per call regardless of the value, so reusing one pooled `ParseOptions` still leaks one entry
>   per parse (measured 43.7 B/parse, 42% less and still unbounded) while forcing a rewrite of the
>   per-parse cancellation handoff P69c had just stabilised. Passing no options at all removes the
>   leak entirely and removes mid-parse cancellation with it. Closing this needs the upstream
>   one-line fix — `ParseCtx` is already marked for removal in 0.26, so that file is in flux — or
>   vendoring tree-sitter's whole C runtime, which `CLAUDE.md`'s library-reuse rule declines.

## Doc updates

#### Commit 7 — `docs(P69d): close the find_references scoping and tree-sitter leak findings`

Both entries in `docs/v1.6/mcp-repo-map-issues.md` must stop reading **Open**.

**`find_references`'s `file` argument does not scope results` → Fixed.** Mark it
`Fixed (<SHA1>, <SHA2>, <SHA3>, <SHA4>)` with this phase's Commits 1-4, each SHA filled in by the
implementer after the commit exists. Add one line naming the sixth facet found while verifying
(`mode` accepts only `nameOnly`, not the documented `name_only`) and that Commit 4 closed it too.
Keep the reproduction table — it is the record of what was wrong.

**`go-tree-sitter` v0.25.0 leaks a `go-pointer` registry entry` → Investigated, not fixable in this
phase; tracked as a known open item.** Correct the magnitude in place: the entry's "10^4-10^5
retained entries per full repository index" is wrong — measured, it is one entry per file parsed,
so 1,878 for this repository, ≈ 0.43 MiB RSS. State that the pooled-options workaround was built and
measured and cannot bound the registry (`pointer.Save` mints a fresh key per call), and point at
`docs/ARCHITECTURE.md`'s Known open items entry as the durable record. Reference Commit 6's SHA.

Also append this pass's own dogfooding line to the **Trivial / session notes** run above the
non-trivial entries, per `CLAUDE.md`'s logging rule: server started headless, stale server killed by
PID, stale token deleted and reminted, called over plain HTTP/JSON-RPC throughout. Worth recording
for the next session: **this pass the server bound the documented `8765`**, not the random high port
P69c's pass saw (46717, and 38721 before that) — so the port genuinely varies and must be read off
the startup line every time, in both directions.

## Explicitly not in this phase

- **`search_symbols`' own prefix ranking.** `less`'s case-insensitive exact tier is right for a
  search tool. Only the *locator* stops using it (Commit 3); `search_symbols` behaves as before.
- **Type-aware resolution.** The 5 surviving `parser.Parse` hits in §A.5 need import and receiver
  information the index does not store. That is C2's documented name-resolution limit, already in
  `docs/ARCHITECTURE.md`.
- **Any `go-tree-sitter` fork, `replace` directive or vendored patch.** §B.4.
- **Re-opening P69b's capture or P69c's cancellation handoff.** Neither is touched; both are
  re-verified in §A.6 and §B.3 respectively.

## Commit list

1. `fix(repomap): resolve a file+line locator that has no byte column`
2. `fix(codegraph): stop attributing a repo-wide-ambiguous reference to one definition`
3. `fix(repomap): resolve a symbol-alone lookup by exact name, not a truncated prefix search`
4. `fix(repomap): validate the languages and mode arguments instead of ignoring them`
5. `test(codegraph): cover the confidence gate and the row-scoped locator fallback`
6. `docs(ARCHITECTURE): record go-tree-sitter's per-parse pointer-registry leak`
7. `docs(P69d): close the find_references scoping and tree-sitter leak findings`

Commits 1-4 each build and each keep `go test ./apps/kira-studio/internal/codegraph/...
./apps/kira-studio/internal/repomap/...` green; run the §A.5 and §A.6 tables once against a rebuilt
server after Commit 4, not per commit. No PR — one feature branch per chapter, `v1.6`.
