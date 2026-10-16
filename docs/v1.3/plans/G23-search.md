# G23 — Search: the Go tail scan, the client matcher, and the RE2/`RegExp` reconciliation

> **What this phase is.** The twenty-third phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and structurally G17's and G22's third sibling: **the wire contract, the client state, and every widget this feature needs already exist and are already wired end to end.** `packages/git-ipc/src/contract.ts` carries `SearchQueryParams` (`:905`), `SearchMatchField` (`:912`), `CommitSearchHit` (`:924`), `SearchRunResult` (`:933`) and the `search.run` request method (`:1479`), all already counted in `CONTRACT_VERSION = 25` and already in `validate.ts`'s `REQUEST_KEYS` (`:146`). `packages/git-core/src/search/{query,matcher}.ts` are byte-identical ports of upstream's own two files, with their 118 + 253 lines of tests. `packages/git-ui` has `SearchBox.vue` (414 lines), `SearchResults.vue`, `searchResultsModel.ts`, `searchHighlight.ts` and a fully implemented `SearchState` (`state/search.ts`, 437 lines) that compiles a query per keystroke, runs `searchLoadedCommits` synchronously against the column store, folds `matchRef` over `RefsState`, debounces a `search.run` request at 200 ms, merges the two halves, and drives `App.vue`'s `revealSha`. **Every one of those `search.run` calls hits `E_UNKNOWN_METHOD` today**: there is no `internal/gitsearch` package, no `search.run` case in `gitrpc/handlers.go`'s switch, no `LogScanArgs`, no `%b`. `grep -ri search` over `internal/gitrpc/`, `internal/gitsession/`, `internal/gitops/` and `internal/gitclient/` returns exactly one hit, and it is `discovery.go` talking about `PATH`. This is a port, not a design phase — **except for one part, which is entirely this phase's own.**
>
> **That one part is the regex dialect.** Upstream had no dialect problem: `repoService.searchCommits` runs `compileQuery` — the *same JavaScript function* the client runs — inside the same Node process, so the tail scan and the loaded scan are one implementation by construction (`packages/core/src/search/query.ts`'s own header: *"there is nothing for a second engine to agree or disagree with"*). This chapter moves the tail scan into Go, and Go's `regexp` is RE2: no lookahead, no lookbehind, no backreferences, and a different meaning for `.`, `\s` and `\p` even where the syntax is accepted by both. SPEC's own "Known open items" (`docs/v1.3/SPEC.md:446-450`) states the stake — *"The server-side tail scan and the client-side scan must agree exactly or a hit's presence depends on which page happens to be loaded"* — and names the shape of the answer: *"a byte-boundary post-check implementation in `gitsearch` rather than a direct pattern port."* G3 D21 (`docs/v1.3/plans/G3-history-pipeline-and-wire-format.md:1081-1092`) deferred it here by name and preserved the one property this phase depends on (the shared `WalkArgs` builder, so the paging walk and the scan agree on order). §2's D3–D6 are that answer, in three tiers, with a differential test that fails if the two engines ever disagree.
>
> **One real scope call, argued and decided.** In `regex` mode a user can type a pattern RE2 structurally cannot run (`(?=`, `(?<=`, `\1`). Silently returning fewer hits is the one outcome SPEC's open item exists to forbid, and reusing `SearchRunResult`'s existing `invalidPattern` member would be both dishonest (the pattern *is* valid) and invisible (`searchResultsModel.ts` renders nothing for it). D6 adds a third `SearchRunResult` member, `unsupportedPattern`, and **bumps `CONTRACT_VERSION` 25 → 26**. §10.1 hands the call to a human with the two alternatives priced.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `11ff270e` (G1–G22 complete; `CONTRACT_VERSION = 25`). Every claim below was checked against source read in this container — both this repo and the upstream checkout at `/home/user/vlad-cirstean/kira-version-vscode` (`claude/start-p2-gwlgly`, `0ea4cfe`, "Merge P11: Search") — never inferred from SPEC prose.

The authoritative spec for this feature is **upstream `docs/SPEC.md` §7.8** (lines 1649–1719 there) plus **upstream `docs/plans/P11.md`** (probes 1–11, hard parts 1–8). SPEC's own "(§8)" in the G23 row does not resolve to a numbered section in *this* repo — the reference is to upstream's numbering. This repo's actual, and binding, statement on the dialect question is `docs/v1.3/SPEC.md:446-450`.

### 0.2 Scope

Upstream's P11 **server half**, plus the two client gaps the port left open. Concretely:

1. **`internal/gitclient/porcelain/log.go`** (edited) — `ScanFormat` (`LogFormat` + `%x1f%b`), `ScanFieldCount = 11`, `LogScanArgs(WalkSpec)`, `ScanRecord`, `ParseScanRecord`.
2. **`internal/gitsearch`** (new package) — SPEC's own package-table row. `Query`/`Compile`/`Compiled`, the literal matcher, the JS→RE2 dialect translator, `MatchFields` (a port of `matchCommitFields`), and the cancellable, time-boxed, streaming `Scan`.
3. **`internal/gitsession/search.go`** (new) — `(*Walk).Search`: the walk-spec source, the supersede slot, the read-gate wrapper.
4. **`internal/gitsession/walk.go`** (edited) — a `Spec()` accessor, and one line in `resetLocked` cancelling an in-flight scan.
5. **`internal/gitrpc`** — one new `Request` case, one handler, one params type, `DefaultSearchLimit`, the `ContractVersion` bump.
6. **`packages/git-ipc`** — `SearchRunResult` gains `unsupportedPattern`; **`CONTRACT_VERSION` 25 → 26** (D6/D13).
7. **`packages/git-core`** — **no deletions.** `search/*` is on SPEC §5's *keep* list (`docs/v1.3/SPEC.md:277`: git-core keeps *"the client-side half of `search/*`"*). One added file: the shared conformance corpus's TS side (D9).
8. **`packages/git-ui`** — `searchResultsModel.ts` renders the new member's message; `SearchState.matchCount` stops calling an unsupported-pattern tail "exact"; `App.vue` wires the four persisted toggles (D12).

### 0.3 Not in this phase

- **The client-side half of search.** `compileQuery`, `searchLoadedCommits`, `matchRef`, `SearchBox.vue`, `SearchResults.vue`, `searchHighlight.ts` and `SearchState`'s merge/debounce/supersede logic were all read line by line during this plan's investigation and are complete and correct. SPEC says so too (`:84`: *"the client-side half of search stay[s] in TypeScript"*). The only client edits are D6's new-member handling and D12's persistence wiring.
- **Refs scope.** `SearchState.refHits` is a pure computed over `RefsState`'s `RefRow[]`; it never touches the wire, by design (`contract.ts:900-903`: *"the tail scan is commits-only, and Refs/Both are resolved entirely client-side"*). Nothing server-side to add.
- **PR number/title matching in the Refs scope.** Upstream §7.8's own paragraph defers it to P12; `matcher.ts:226`'s `pr?` parameter is that seam, `void pr` today. **G24** owns it (SPEC's G24 row names *"PR number/title matching added to search's ref scope"* explicitly).
- **File-content search (`log -S`/`-G`).** Upstream §7.8's last line: v2, deliberately a different mental model.
- **Stash rows in the scan.** Upstream filters them with `applyStashRowFilter`; here `IncludeStash` is `false` on every walk this repo builds (G17 D1 left the graph integration out), so `LogScanArgs` never emits a stash sha and there is nothing to filter (F10).
- **A palette command.** Search is read-only and is not an `OpRequest` kind, so `commands.test.ts`'s G10 D20 rule does not fire (F13). §10.6 is the human-eye item on whether to add one anyway.
- **Re-measuring the graph budgets.** SPEC's second open item is G3/G8's; this phase adds one opt-in scan benchmark of its own (§7.1(8)) and nothing more.
- **No `docs/v1.3/SPEC.md` edit** — same convention G12/G14/G15/G16/G17/G22 followed. The G23 row is correct as written; §9 records the one clarification a future reader wants (the "(§8)" pointer).

### 0.4 Ground rules

- **The pattern never reaches git.** Upstream §7.8 states it as a rule and probes 1/2/3 prove it: `--grep`/`--author`/`--committer` are ANDed across categories, `--grep` cannot match an object name, and git's own regex dialect is the platform's. `LogScanArgs` carries a rev set and a format string, and never a user pattern. Any deviation would be a fourth engine to reconcile.
- **One walk, one order.** `LogScanArgs` is built from `WalkArgs(spec)` — the same call `LogSessionArgs` makes — so the loaded rows are a *prefix* of the scan's sequence (upstream probe 11) and `buildCommitHits` can concatenate without sorting. G3 D21 preserved this deliberately; do not string-substitute one builder's output to make the other.
- **Never a second engine's semantics, silently.** Where Go and JS can be made to agree exactly, they are, and a differential test proves it. Where they cannot, the server says so as data (D6) rather than returning a smaller answer.
- **Reuse the existing spawn discipline.** `gitclient.Runner.Start` + `porcelain.RecordSplitter` + `gitclient.Classify`, the same three the paged walk already composes. No new runner, no new framing primitive.
- **Fix a stale label where this phase's own diff already touches its neighbourhood**, and no further (D14) — the line G17 D10 and G22 D11 both drew.

---

## 1. Findings

### F1 — The entire wire contract for this feature already exists, at `CONTRACT_VERSION = 25`

`packages/git-ipc/src/contract.ts`:

- `SearchQueryParams` (`:905-910`) — `text`/`caseSensitive`/`wholeWord`/`regex`. A structural copy of `git-core`'s `SearchQuery` **minus `scope`**, with the header comment (`:900-903`) stating why: the tail scan is commits-only.
- `SearchMatchField` (`:912-920`) — the seven commit-side members of `git-core`'s own nine-member `SearchField` (no `refName`, no `tagAnnotation`).
- `CommitSearchHit` (`:924-931`) — *"Enough to render a dropdown row without a second round trip, and nothing more."*
- `SearchRunResult` (`:933-947`) — `{kind:'ok', hits, total, truncated, scanned, complete}` with `total` documented as *"EXACT, counted over every commit scanned — not `hits.length`"* and `complete` as *"`false` ⇒ the host-side time box fired before git's own end"*; plus `{kind:'invalidPattern', message}`, *"Never thrown (probe 4)."*
- `'search.run'` (`:1474-1482`), params `{repoId, query, limit?}`, with the doc comment naming its own cancellation design: *"One request, one cancellable read — no cancel key, no second walk session … Superseded by the caller's own `AbortSignal`, which `rpc.ts` already threads to the spawn."*

`gitrpc/contract.go`'s `ContractVersion = 25` history never mentions search, because none of it needed to: the whole P1–P11 vocabulary landed when `packages/git-ipc` was ported whole at G1.

### F2 — Zero Go implementation exists anywhere in the serving path

- There is **no `internal/gitsearch` directory**. `ls apps/kira-studio/internal/` shows `gitaskpass`, `gitclient`, `gitops`, `gitpreflight`, `gitreview`, `gitrpc`, `gitsession`, `gitsock`, `gitstore`, `gitvsix`, `gitwire` — the one package SPEC's table names for this phase is the one that does not exist.
- `gitrpc/handlers.go`'s `Router.ForConn` switch has no `search.run` case. Such a call falls through to `default: E_UNKNOWN_METHOD`.
- `grep -rn -i search` over `internal/gitrpc/`, `internal/gitsession/`, `internal/gitops/`, `internal/gitclient/` returns exactly one line — `gitclient/discovery.go:54`, about `PATH` — and two stale forward references (F6).

So on every repository large enough that `tailSkippedByExhaustion` is false (>20 000 rows, or history not yet fully loaded), every debounced keystroke past two characters currently issues a request that is rejected. `SearchState.#runTail`'s `.catch` swallows it deliberately (`state/search.ts:417-422`: *"surfacing nothing is preferable to crashing the panel over a search; the loaded half still stands on its own"*), so the failure is invisible — the user simply never gets a body match or a hit past the loaded prefix.

### F3 — The client half is complete, wired, and not stubbed

- `git-core/src/search/query.ts` (92 lines) and `matcher.ts` (240) are byte-for-byte the same length as upstream's; their tests (118 + 253) likewise.
- `git-ui/src/state/search.ts` (437, identical to upstream's) implements: per-keystroke `compileQuery`; the synchronous loaded scan with a 120 ms time box; `refHits` as a pure computed; a 200 ms debounced `search.run` with `AbortController` supersede and a `stillCurrent()` guard; `buildCommitHits`'s loaded/tail merge with the `overlapCount` correction; `matchCount`'s exactness rule; `next`/`previous`; `runBodySearch()`; `tailStale` off `repo.changed{refsChanged}`; and `MIN_TAIL_QUERY_LENGTH`/`SKIP_TAIL_MAX_ROWS` skip conditions.
- `App.vue` constructs one `SearchState`, calls `setRepoId` on repo switch, watches `activeHit` into `revealSha`, disposes it, and passes it to `AppToolbar`/`SearchBox`/`SearchResults`.

Nothing here is a stub. This is the exact asymmetry G17 §0 and G22 §0 both opened on.

### F4 — `matchCommitFields` has no production caller in this repo, and must not be deleted

`grep -rn 'matchCommitFields'` over `packages/` and `apps/kira-studio-vscode/src` finds: the definition, the `index.ts:161` re-export, and `matcher.test.ts`. **No production caller.** That is not rot: upstream's only caller was `repoService.searchCommits` — the *server*. In this chapter the server is Go, so the TypeScript function's job moves.

G17/G22's reflex (a classifier with no caller and a Go twin landing in the same phase gets deleted) is **wrong here**, for two reasons stated as D8: SPEC §5 explicitly keeps `search/*` in `git-core` (`docs/v1.3/SPEC.md:277`), and this function is the only executable specification of the semantics the Go port must reproduce. D9 promotes it from dead code to the **conformance oracle**.

### F5 — `matcher.test.ts` is already a data-driven semantics table, and is therefore already the corpus

`packages/git-core/src/search/matcher.test.ts:56-118` declares `TOGGLE_ROWS: readonly ToggleRow[]` — eight rows keyed by upstream's own P11 W16 table numbering (1–7, 9), each `{row, toggles, text, matches, notMatches}` over five fixed `CommitFields` fixtures (`WIDGET_CACHE`, `ADD_WIDGETS`, `SUBWIDGETARY`, `UNRELATED`, `HASH_123`). Row 3 is whole-word on a word edge; **row 7 is `regex: true, wholeWord: true`** — the exact combination the dialect work has to get right; **row 9 is `#123` with whole-word**, upstream probe 10's punctuation-edge trap, the case that makes the naive `\b…\b` wrapper wrong.

The table is already data. D9 lifts it into a language-neutral JSON file both suites read, rather than transcribing it into Go by hand where the two copies could drift.

### F6 — Two stale forward references name this phase's own job under a label that no longer resolves to it

Both predate SPEC's `7698873a` renumbering:

- `internal/gitclient/porcelain/log.go:33` — *"shared by the paged walk, the remaining-count query (`rev-list --count`) and, in **G10**, the tail scan, so all three agree on exactly the same commits in exactly the same order (D8/D21)."*
- `internal/gitclient/porcelain/types.go:59` — the same sentence on `WalkSpec`.

D14 fixes both, in the commit that adds `LogScanArgs` two functions below the first of them.

### F7 — G3 deferred this by name, and preserved the one property the scan depends on

`docs/v1.3/plans/G3-history-pipeline-and-wire-format.md:1081-1092`, verbatim:

> ### D21 — RE2 vs. JS `RegExp` is untouched, and stays G10's
> … It is not: G3 compiles no pattern, matches no text, and creates no `gitsearch` package. `packages/git-core/src/search/matcher.ts` travels unchanged and unloaded.
> The one thing G3 does that G10 will depend on is preserved deliberately: `logSessionArgs` and (in G10) `logScanArgs` are built from the *same* `walkArgs(walk)` call, so the paging walk and the tail scan produce byte-identical ordering over the same rev set — upstream's own probe-11 property.

`porcelain.WalkArgs` (`log.go:55`) is that builder. `LogScanArgs` calls it (D1), and does not derive its argv by patching `LogSessionArgs`'s output.

### F8 — Per-request cancellation already works end to end; this phase adds no cancel method

`packages/git-ipc/src/rpc.ts:248-256` posts `{t:'cancel', id}` when the caller's `AbortSignal` fires. `internal/bridge/rpcstream/session.go:174-180` gives every inbound `req` its own `context.WithCancel`, registers the cancel in `activeWork[id]`, and cancels it on a `cancel` frame, with disconnect cancelling everything. `gitrpc`'s handlers already receive that `ctx`.

So "cancellable tail scan" needs no new wire surface: the scan reads `ctx.Done()` and kills its child, exactly as `logsession.readChunkLocked` already does. `SearchState.#runTail`'s `#tailController.abort()` on every new keystroke is what drives it.

### F9 — There is no streaming one-shot read helper in Go, and the paged walk must not be reused

`grep -rn '\.Start('` over `internal/` finds exactly two consumers of `gitclient.Runner.Start`: `logsession/session.go:231` and `catfile/session.go:72`. Every other read goes through `gitclient.Run`, which **buffers the whole of stdout into `[]byte`**. Upstream probe 5b measured the scan's output at 10.2 MB over 30 000 commits with realistic bodies and ~20 MB over 100 000; buffering that per keystroke is avoidable and pointless when the matcher is a streaming fold. So `gitsearch.Scan` gets its own read loop, built from the same three pieces `logsession` composes (`Runner.Start` → `RecordSplitter.Push` → `Classify` at EOF), injected through a `Deps` struct in exactly `logsession.Deps`'s shape.

It must **not** read from the paused `logsession`: upstream's hard part 3 states why (*"a paused session is mid-walk with page state; its argv cannot be changed while it runs, and reading from it to answer a search would consume the paging walk's own records"*), and here the argv differs anyway (`ScanFormat` ≠ `LogFormat`).

### F10 — The stash row filter is TS-only and structurally unnecessary here

`applyStashRowFilter`/`buildStashRowFilter` (`packages/git-core/src/graph/stashRows.ts`) are exported and called by nothing. Upstream's `searchCommits` calls it because upstream walks `refs/stash`. Here `porcelain.RevSetArgs` only appends `spec.StashShas` when `spec.IncludeStash` is true, and **no call site in this repo ever sets it** — G17 D1 decided that deliberately. So the Go scan has no stash rows to exclude, and D2's `ParseScanRecord` does not need to parse `%D` at all.

### F11 — The four persisted search toggles are never wired to `SearchState`, in this repo *or* upstream

`PersistedViewState` (v5) carries `searchCaseSensitive`/`searchWholeWord`/`searchRegex`/`searchScope` (`viewState.ts:52-55`), validated in `isPersistedViewState`. `App.vue:766-771` says out loud that nothing reads them yet. `grep 'searchCaseSensitive'` over upstream's `packages/ui/src/App.vue` finds the identical four lines and no wiring either. So this is an **upstream gap faithfully ported**, not a regression introduced here. D12 closes it; §10.4 prices it.

### F12 — `buildCommitHits.test.ts` is named in a doc comment and does not exist

`state/search.ts:75-77`: *"Exported for `buildCommitHits.test.ts` — the merge is subtle enough (and was untested enough) to deserve direct, pure-function coverage."* `ls packages/git-ui/src/state/` shows `repoSettings.test.ts` and `viewState.test.ts` and no third. D11 writes it — the merge is exactly what this phase makes reachable for the first time (before this phase `tail` is always `undefined`, so `buildCommitHits`'s entire tail branch is dead at runtime).

### F13 — The palette-registration rule does not fire for this phase

`apps/kira-studio-vscode/src/commands.test.ts` extracts `opTable`'s keys out of `ops.go`'s source and requires a real `PaletteCommand` for each (G10 D20). Search is not an `OpRequest` kind and never enters `opTable`, so the test is silent about it. The non-mutating precedent exists — `OTHER_COMMANDS` carries `kiraVersion.refresh` with a `UiActionKind` of `'refresh'` — but nothing obliges this phase to use it. §10.6.

### F14 — `Walk` holds the spec the scan needs, privately

`gitsession.Walk.spec` is the `porcelain.WalkSpec` the connection's graph is currently walking, fixed for the walk's life. `Conn.WalkFor(repoID) (*Walk, bool)` is the lookup. There is no exported accessor; D4 adds `func (w *Walk) Spec() porcelain.WalkSpec`, returning a copy.

`Conn.ReviewWalkFor` is the *review* range walk and is deliberately not what search reads: `search.run` carries no `range`, and `SearchState` is the graph panel's.

### F15 — The dialect inventory, derived rather than assumed

What `compileQuery` actually produces: `new RegExp(source, caseSensitive ? '' : 'i')` — no `u`, no `m`, no `g`, no `y`. `source` is `escapeRegExp(text)` (literal mode) or `text` verbatim (regex mode), optionally wrapped by whole-word.

Against Go's `regexp` (RE2), over exactly that surface:

| Construct | JS (no `u`, no `m`) | Go RE2 | Verdict |
|---|---|---|---|
| `\b`, `\B` | ASCII word boundary over `[A-Za-z0-9_]` | ASCII word boundary, same class | **Identical** |
| `\d` `\D` `\w` `\W` | ASCII | ASCII | **Identical** |
| `^` `$` | start/end of input (no `m`) | start/end of text (no `(?m)`) | **Identical** |
| `\s` `\S` | wider Unicode whitespace class | `[\t\n\f\r ]` | **Differs** — rewritable |
| `.` | excludes `\n \r    ` | excludes `\n` | **Differs** — rewritable |
| `\p` `\P` | identity escape → literal `p`/`P` | Unicode class | **Differs** — rewritable |
| `\uXXXX`, `\u{…}`, `\cX`, `\0` | JS escapes | not RE2 syntax | **Differs** — rewritable |
| unknown escape `\q` | identity escape → literal `q` | compile error | **Differs** — rewritable |
| `(?=` `(?!` `(?<=` `(?<!` | supported | not expressible | **Not expressible** |
| `\1`, `\k<n>` | backreference | not expressible | **Not expressible** |
| `(?<name>…)` | supported | accepted (Go ≥1.22) | Identical |
| `i` flag folding | ECMA-262 `Canonicalize`, suppressed when a non-ASCII char uppercases to ASCII | `unicode.SimpleFold`, no such suppression | **Differs** — e.g. `/k/i` does **not** match `K` (U+212A) in JS; `(?i)k` **does** in Go |

The derivation that makes whole-word tractable: at position *p*, JS's `(?<!\w)` asserts *p = 0 or text[p−1] ∉ `\w`*. If the character **at** *p* is a word character, that is exactly `\b`. If the character at *p* is **not** a word character, it is exactly `\B`. Symmetrically for `(?!\w)` at the end.

In **literal** mode both edge characters are known — they are the first and last characters of the user's own text — so `(?<!\w)`/`(?!\w)` are expressible in RE2 exactly, as `\B`/`\B`. In **regex** mode the matched text's edges are not known from the pattern (`(foo|#bar)`), which is precisely why upstream always uses the lookaround form there.

### F16 — Upstream's measured numbers, which price every alternative in §10

From `docs/plans/P11.md` probes 5b and 6, on real fixtures:

- Adding `%b` to the scan format doubles output bytes (5.6 MB → 10.2 MB at 30k commits) and costs **~3 ms**.
- Letting git filter (`--grep -F -i` matching nothing) costs 221 ms against a 254 ms full scan — *"letting git filter buys pipe bytes, not time"*.
- The three-spawn union that would actually compute §7.8's OR semantics costs **703–756 ms**, 2.7× one scan.
- A full host-side scan with matching: **30k commits → ~400 ms, first hit at ~19 ms; 100k commits → ~1.1 s, 19.7 MB, first hit at ~33 ms.**
- A user-typed `(a+)+$` against a 31-character string takes **853 ms** in JS. On the Go side this specific hazard does not exist — RE2 has no backtracking and is linear in input — which is a real, free win of moving the scan to Go.

---

## 2. Decisions

### D1 — `porcelain`: `ScanFormat`, `LogScanArgs`, built from the same `WalkArgs` call

Added to `internal/gitclient/porcelain/log.go`, beside `LogSessionArgs`:

```go
// ScanFormat is LogFormat plus the raw body, LAST — so SplitLimitedFields' "the final field
// absorbs every extra delimiter" rule keeps a body containing a stray 0x1f harmless.
const ScanFormat = LogFormat + "%x1f%b"

// ScanFieldCount is ScanFormat's own field count.
const ScanFieldCount = 11

// LogScanArgs is G23's tail-scan argv: the same log vocabulary and the same WalkArgs(spec) call
// LogSessionArgs makes, with ScanFormat in place of LogFormat. This is what makes upstream probe
// 11's ordering property hold — the paging walk and the scan are the same --topo-order walk over
// the same rev set, so the loaded rows are a PREFIX of the scan's sequence and git-ui's
// buildCommitHits can concatenate the two halves without sorting anything.
func LogScanArgs(spec WalkSpec) []string {
	args := []string{"log", "--decorate=full", "--topo-order", "-z", "--format=" + ScanFormat}
	return append(args, WalkArgs(spec)...)
}
```

`--decorate=full` is kept even though `ParseScanRecord` discards `%D` (D2): dropping it would change `%D`'s *content*, and the whole point of D1 is that the two argvs differ in exactly one token.

### D2 — `ParseScanRecord` is lean on purpose, and says so

```go
// ScanRecord is one tail-scan record: every field gitsearch matches on, and nothing else.
type ScanRecord struct {
	SHA       string
	Subject   string
	Body      string
	Author    CommitIdentity
	Committer CommitIdentity
}

// ParseScanRecord splits ScanFormat's eleven %x1f fields. Deliberately leaner than
// ParseLogRecord: %P and %D are split off positionally and then DROPPED unparsed, because this
// backend never walks refs/stash — WalkSpec.IncludeStash is false at every call site in this repo
// (G17 D1) — so there is nothing to filter and no reason to pay parseDecoration per record over a
// 100k-commit walk. The field INDICES still track LogFormat exactly.
func ParseScanRecord(record []byte) (ScanRecord, error)
```

Two details ported verbatim from upstream: the trailing newline `%b` emits before the record's NUL is trimmed exactly once; a record shorter than eleven fields is a parse error, matching `ParseLogRecord`'s own contract.

### D3 — Literal mode uses no regex engine at all, and is byte-exact by construction

```go
// literalMatcher answers "does needle occur in s with acceptable word boundaries", exactly as
// JavaScript's own RegExp does for the pattern compileQuery builds in literal mode.
//
// Why no regexp here at all: in literal mode the JS pattern is escapeRegExp(text) — a fixed
// string — optionally wrapped in \b…\b or (?<!\w)…(?!\w). For a FIXED needle, "the wrapped JS
// pattern matches s" is equivalent to "SOME occurrence of needle in s has a non-word character
// (or nothing) on each side". Enumerating occurrences and post-checking their two edge bytes
// computes that directly, with no dialect to reconcile — SPEC's own "a byte-boundary post-check
// implementation in gitsearch rather than a direct pattern port" (docs/v1.3/SPEC.md:449).
type literalMatcher struct {
	needle    string // already case-folded when fold is true
	fold      bool
	wholeWord bool
}
```

Three pieces:

1. **Occurrence enumeration.** `strings.Index` in a loop for the case-sensitive path; for the folded path an `indexFold` that walks rune-by-rune with the fold below. Whole-word off ⇒ the first occurrence is the answer; whole-word on ⇒ keep going until one passes the boundary check or the haystack is exhausted.
2. **The boundary check, on bytes.** `isWordByte(b) = b == '_' || ('0' <= b && b <= '9') || ('A' <= b && b <= 'Z') || ('a' <= b && b <= 'z')`. A byte ≥ 0x80 is not a word byte — exactly right, since JS's `\w` without the `u` flag is ASCII-only. Start/end of string count as boundaries. Upstream probe 10's four rows (`widget` in `the widget cache` ✓, `(#12` in `fix (#123)` ✗, `#123` in `fix (#123)` ✓, `v1.2` in `tag v1.2.0 here` ✓) are four Go test cases.
3. **The fold, ECMA-262's own.** Not `strings.ToLower`, not `unicode.SimpleFold`:

```go
// foldRune is ECMA-262 Canonicalize for a non-unicode-flag RegExp: uppercase the code point, and
// KEEP THE ORIGINAL when the input is non-ASCII and the uppercase result is ASCII. That last
// clause is why /k/i does not match U+212A KELVIN SIGN in JavaScript while Go's own (?i)k does.
func foldRune(r rune) rune {
	if r < utf8.RuneSelf {
		if 'a' <= r && r <= 'z' { return r - 'a' + 'A' }
		return r
	}
	u := unicode.ToUpper(r)
	if u < utf8.RuneSelf { return r }
	return u
}
```

`compileQuery`'s `MIN_SHA_PREFIX` arm is separate from the pattern and identical in both languages: `text` matching `^[0-9a-fA-F]{4,40}$` sets `shaPrefix = text.toLowerCase()`, tested with `startsWith` against the lower-cased sha. Port literally.

### D4 — Regex mode: a bounded JS→RE2 source translator, `gitsearch/dialect.go`

A single left-to-right pass over the pattern source, rewriting the seven constructs F15 marks *rewritable* and refusing the two it marks *not expressible*:

| In | Out | Why |
|---|---|---|
| `.` (outside a class) | `[^\n\r\x{2028}\x{2029}]` | JS `.` excludes four characters, RE2's excludes one |
| `\s` / `\S` | the explicit JS class / its negation | F15's table |
| `\p` / `\P` | `p` / `P` (escaped literal) | identity escape without the `u` flag |
| `\uXXXX`, `\u{H+}` | `\x{XXXX}` | JS escape spelling |
| `\cA`–`\cZ` | `\x{01}`–`\x{1a}` | JS control escape |
| `\0` not followed by a digit | `\x{00}` | JS NUL escape |
| any other `\X` RE2 rejects | `\` + quoted `X` | JS identity-escape rule |
| `(?=` `(?!` `(?<=` `(?<!` | **reject** → `ErrUnsupported` | RE2 cannot express them |
| `\1`…`\9`, `\k<name>` | **reject** → `ErrUnsupported` | RE2 cannot express them |

The result is handed to `regexp.Compile` with `(?i)` prepended when `caseSensitive` is false. A `regexp.Compile` error after translation is also `ErrUnsupported` (never `invalidPattern` — the client already proved the pattern compiles in JS before it ever sent it; see D6).

Two honest limits, written into the package doc: case folding in regex mode is RE2's `(?i)`, not `foldRune` — the Kelvin-sign class of difference survives here (§10.3); and `(?i)` composes with an inline `(?i)` in the user's pattern the way RE2 says, which is also what JS does.

### D5 — Whole-word in regex mode: a consuming rewrite, anchor-aware

Upstream always uses the lookaround form in regex mode. RE2 cannot express it, and a naive post-check on `FindStringIndex` is **wrong**: JS backtracks into a *different alternative* when the boundary fails (`foo|foobar` against `foobar` matches via the second branch), and Go's leftmost-first search returns only the first.

The rewrite, applied to the *translated* source `P`:

```
(?:\A|[^0-9A-Za-z_])(?:P)(?:[^0-9A-Za-z_]|\z)
```

Existence-equivalent to `(?<!\w)(?:P)(?!\w)`. Since `MatchFields` only ever asks a boolean question per field, consuming the delimiters is free.

Two guards: if `P` can match at the start anchor (`^`/`\A` at top level), drop the leading alternation and use `\A` alone (otherwise the consumed character makes the anchor unsatisfiable); symmetrically for a trailing `$`/`\z`.

The differential test (D10) fuzzes this specifically: 500 generated regex-mode patterns × 200 generated subjects, Go vs. Bun, asserting identical booleans.

### D6 — `SearchRunResult` gains `unsupportedPattern`; the server never lies by omission

When D4 rejects, the server has three options and only one of them is honest: reusing `invalidPattern` is dishonest (the pattern is valid) and invisible (`searchResultsModel.ts` renders nothing for it); faking `{ok, complete:false, scanned:0}` is misleading (`complete:false` already means the time box fired). **A third member:**

```ts
  /** G23: the pattern is valid JavaScript (the client compiled it before sending) but uses
   *  syntax the Go tail scan's RE2 engine cannot run — lookahead, lookbehind, or a backreference.
   *  The loaded-commit half of the search is unaffected and still complete; only the not-yet-
   *  walked tail (and therefore any body-only match) is missing. */
  | { readonly kind: 'unsupportedPattern'; readonly message: string };
```

Client side: `searchResultsModel.ts` gains a `tailNotice: string | undefined`; `SearchResults.vue` renders it beside `loadedFooter`/`tailFooter`; `SearchState.matchCount`'s `tailExact` becomes `tail === undefined || tail.kind === 'invalidPattern' || (tail.kind === 'ok' && !tail.truncated && tail.complete)`.

`invalidPattern` stays on the wire: this server never emits it (D7), but it is a legitimate answer for a non-webview client.

### D7 — `gitsearch.Compile` is the one compilation site, and its failure modes are typed

```go
// Compile turns a wire SearchQueryParams into the one matcher this package runs — the mirror of
// git-core's compileQuery, which is the only place in the TypeScript half a pattern is interpreted.
//
//   literal mode  -> a literalMatcher (D3). Cannot fail.
//   regex mode    -> dialect.Translate + regexp.Compile (D4/D5).
//                    ErrUnsupportedPattern for lookaround/backreference/anything RE2 rejects.
//                    ErrInvalidPattern is unreachable from the webview (the client compiles with
//                    JS first); it exists for a raw socket client.
func Compile(q Query) (*Matcher, error)
```

Empty `text` returns a matcher that matches nothing and a handler short-circuit to `{ok, hits:[], total:0, scanned:0, complete:true}` — upstream's own `kind === "empty"` branch, ported.

### D8 — `MatchFields` is a field-for-field port of `matchCommitFields`, order included

```go
// Field mirrors the wire's SearchMatchField exactly — the seven commit-side members of git-core's
// own nine-member SearchField.
type Field string

// MatchFields is a straight OR over seven tests — the AND-across-categories semantics
// `git log --grep --author` would give is exactly what upstream probe 1 rules out. Returns every
// field that matched.
//
// The ORDER of the returned slice is a contract: matcher.test.ts asserts exact arrays. subject,
// body, authorName, authorEmail, committerName, committerEmail, sha — matcher.ts's own order.
//
// The empty-body guard is ported deliberately: a pattern matching the empty string reports
// `subject` and not `body` on a body-less commit.
func (m *Matcher) MatchFields(f CommitFields) []Field
```

### D9 — One shared conformance corpus, asserted by both languages

- **`packages/git-core/testdata/searchConformance.json`** — a corpus of `{name, query, subject, body, authorName, authorEmail, committerName, committerEmail, sha, expect: {supported, fields}}` records, seeded from `matcher.test.ts`'s `TOGGLE_ROWS` (F5) and extended with: probe 10's punctuation-edge rows; the sha-prefix floor; body-only hits; the empty-body guard; a `\s`-in-regex row over a NBSP; a `.`-in-regex row over a `\r`; a `\p{L}` row; a `\uXXXX` row; three `supported: false` rows (`(?=x)`, `(?<=x)`, `(a)\1`); and the `regex + wholeWord` `foo|foobar`/`foobar` case (D5).
- **`packages/git-core/src/search/conformance.test.ts`** — reads the JSON, runs `compileQuery` + `matchCommitFields`.
- **`apps/kira-studio/internal/gitsearch/conformance_test.go`** — reads the same JSON, runs `Compile` + `MatchFields`, asserts `errors.Is(err, ErrUnsupportedPattern)` for every `supported: false` row.

One file, both engines.

### D10 — A differential fuzz test, opt-in, guarding what a hand-written corpus cannot

`internal/gitsearch/differential_test.go`, gated on `KIRA_GIT_DIFFERENTIAL=1` and skipped under `testing.Short()` (G3 D22's own posture): generate ~500 patterns from a small grammar × the four toggle combinations × ~200 subjects; run each through Go's `Compile`+`MatchFields`; shell out once to `bun` importing `compileQuery`/`matchCommitFields`; diff. §7.1 requires one green run in the phase's own final check.

### D11 — `gitsearch.Scan`: streaming, cancellable, time-boxed, exact `total`

`internal/gitsearch/scan.go`, with `logsession.Deps`'s shape:

```go
type Deps struct {
	Runner  gitclient.Runner
	GitPath string
	Dir     string
}

type Options struct {
	Args    []string
	Matcher *Matcher
	Limit   int
	Budget  time.Duration
}

type Result struct {
	Hits      []Hit
	Total     int
	Truncated bool
	Scanned   int
	Complete  bool
}

// DefaultScanBudget is upstream's own SEARCH_SCAN_BUDGET_MS. Checked every 1024 records.
const DefaultScanBudget = 5 * time.Second

// DefaultLimit is upstream's own DEFAULT_SEARCH_LIMIT — 200 tail hits. Total is exact regardless.
const DefaultLimit = 200
```

The loop, built from the three pieces `logsession` already composes: `Runner.Start` → read 64 KiB chunks through the same select-on-`ctx.Done()` shape as `logsession.readChunkLocked` → `RecordSplitter.Push` → `ParseScanRecord` → `MatchFields`. `Scanned++` per record; on a match `Total++`, `Hits` capped at `Limit` but the scan **runs to git's own end regardless** so `Total` stays exact. Every 1024 records, check the deadline. `ctx.Err()` propagates as `gitclient.ErrCancelled`.

One Go-specific note in the package doc: RE2 has no backtracking, so upstream's probe-10 catastrophic-backtracking hazard cannot occur here — the 5 s budget guards against a very large repository, not a pathological pattern.

### D12 — `(*Walk).Search`: the spec, the gate, and the supersede slot

```go
// Search is search.run's server half: gitsearch.Scan over THIS walk's own rev set — w.spec, not a
// fresh default, so every hit is a row the graph can actually reveal, and probe 11's
// ordering-identity property holds between a loaded page and a scan.
//
// Runs inside entry.Repo.Read: a bounded one-shot read belongs in the four-slot reader pool like
// every other read — NOT logsession's direct-spawn exception, which exists because a PAUSED
// process would hold a slot forever; a scan terminates.
//
// One in-flight scan per walk: a new call cancels the previous one before spawning, as the
// host-side belt to the client's own abort-on-supersede brace.
func (w *Walk) Search(ctx context.Context, q gitsearch.Query, limit int) (gitsearch.Result, error)
```

`resetLocked` gains one line cancelling any in-flight scan on a walk rebuild. `Walk.Spec()` (F14) returns `w.spec` by value.

### D13 — `CONTRACT_VERSION` 25 → **26**, for exactly one new `SearchRunResult` member

State it plainly so no later phase's planner claims 26 blind: **this phase's own additions produce `CONTRACT_VERSION = 26` / `ContractVersion = 26`.** Nothing else on the wire changes.

### D14 — Stale-label cleanup, exactly at the two lines F6 names

`porcelain/log.go` and `porcelain/types.go`: `"and, in G10, the tail scan"` → `"and G23's tail scan (LogScanArgs)"`. Nothing else touched.

---

## 3. The Go side, file by file

### 3.1 `internal/gitclient/porcelain/log.go` — edited (D1/D2/D14)
`ScanFormat`, `ScanFieldCount`, `LogScanArgs`, `ScanRecord`, `ParseScanRecord`; two comment fixes.

### 3.2 `internal/gitclient/porcelain/log_test.go` — edited
Argv comparison against `LogSessionArgs`; field-index tracking; `ParseScanRecord` against captured real byte sequences (multi-paragraph body, a body containing a literal `0x1f`, empty body, trailing-newline, CRLF body).

### 3.3 `internal/gitsearch/doc.go` — **new**
Package header: what runs here vs. `packages/git-core/src/search/`, the three-tier dialect posture, the named twin and the rule that a change to either lands in both plus the corpus.

### 3.4 `internal/gitsearch/query.go` — **new** (D7)
`Query`, `Matcher`, `Compile`, `ErrUnsupportedPattern`, `ErrInvalidPattern`, `MinShaPrefix = 4`.

### 3.5 `internal/gitsearch/literal.go` — **new** (D3)
`literalMatcher`, `indexFold`, `foldRune`, `isWordByte`.

### 3.6 `internal/gitsearch/dialect.go` — **new** (D4/D5)
`Translate`, the class/escape state machine, `wrapWholeWord`.

### 3.7 `internal/gitsearch/matcher.go` — **new** (D8)
`Field`, `CommitFields`, `Hit`, `(*Matcher).MatchFields`.

### 3.8 `internal/gitsearch/scan.go` — **new** (D11)
`Deps`, `Options`, `Result`, `DefaultScanBudget`, `DefaultLimit`, `Scan`.

### 3.9 `internal/gitsearch/*_test.go` — **new**
`literal_test.go`, `dialect_test.go`, `matcher_test.go`, `scan_test.go`, `conformance_test.go`, `differential_test.go`.

### 3.10 `internal/gitsession/search.go` — **new** (D12)
`(*Walk).Search`, the supersede slot.

### 3.11 `internal/gitsession/walk.go` — edited (D12)
`Spec()`; the new fields; one line in `resetLocked`; one in `dispose`.

### 3.12 `internal/gitsession/search_test.go` — **new**
A real fixture repo through a real `Walk`: a hit in the not-yet-loaded tail; a body-only hit on an already-loaded row; supersede; the read gate is respected.

### 3.13 `internal/gitrpc/search.go` — **new**
`handleSearchRun`: unmarshal, validate `repoId`, resolve the walk (fallback to a default spec matching `handleGraphStatus`'s own), apply `DefaultSearchLimit`, call `Walk.Search`, map the outcome (success/`ErrUnsupportedPattern`/`ErrInvalidPattern`/`ErrCancelled`/other).

### 3.14 `internal/gitrpc/wire.go` — edited
`SearchRunParams`, `SearchQueryParams`.

### 3.15 `internal/gitrpc/handlers.go` — edited
One `case "search.run":` arm.

### 3.16 `internal/gitrpc/contract.go` — edited
`ContractVersion` 25 → 26.

### 3.17 `internal/gitrpc/search_test.go` — **new**
Param validation; `unsupportedPattern` end to end; a real-socket end-to-end test.

### 3.18 Not edited
`internal/gitops/`, `internal/gitpreflight/`, `internal/gitclient/runner.go`, `internal/gitclient/porcelain/records.go`, `internal/bridge/rpcstream`, `internal/gitwire`.

---

## 4. The TypeScript / Vue side, file by file

### 4.1 `packages/git-ipc/src/contract.ts` — edited (D6): one new `SearchRunResult` member
### 4.2 `packages/git-ipc/src/validate.ts` — edited (D13): `CONTRACT_VERSION = 26`
### 4.3 `packages/git-core/testdata/searchConformance.json` — **new** (D9)
### 4.4 `packages/git-core/src/search/conformance.test.ts` — **new** (D9)
### 4.5 `packages/git-core/src/search/matcher.ts` — edited (comment only): twin-reference to `internal/gitsearch`, oracle status
### 4.6 `packages/git-ui/src/components/searchResultsModel.ts` — edited (D6): `tailNotice`
### 4.7 `packages/git-ui/src/components/SearchResults.vue` — edited (D6): one notice row
### 4.8 `packages/git-ui/src/state/search.ts` — edited (D6): `matchCount`'s `tailExact` clause
### 4.9 `packages/git-ui/src/state/buildCommitHits.test.ts` — **new** (F12/D11)
### 4.10 `packages/git-ui/src/App.vue` — edited (D12/F11): wire the four persisted toggles
### 4.11 `packages/git-ui/src/state/viewState.test.ts` — edited: round-trip case for the four search fields
### 4.12 Not edited
`packages/git-core/src/search/query.ts`/`matcher.ts` (logic), `graph/stashRows.ts`, `SearchBox.vue`, `searchHighlight.ts`, `CommitGrid.vue`, `apps/kira-studio-vscode/src/commands.ts`, `package.json`, `packages/git-ipc/schema/gitwire.fbs`.

---

## 5. Dependencies and tooling

Nothing new. `regexp`, `strings`, `unicode`, `unicode/utf8` are standard library. D10's differential test needs `bun` on `PATH`, already present, and is opt-in regardless.

---

## 6. Implementation order

One sequential subagent.

1. **`porcelain`**: `ScanFormat`/`LogScanArgs`/`ParseScanRecord` + tests + D14's fixes (§3.1–3.2).
2. **`gitsearch` the matcher**: `query.go`, `literal.go`, `dialect.go`, `matcher.go` + unit tests (§3.4–3.7, 3.9). Green before anything spawns a process.
3. **The corpus**: `searchConformance.json` + both readers (§3.9, §4.3–4.4).
4. **`gitsearch.Scan`** + `scan_test.go` (§3.8–3.9).
5. **`gitsession/search.go`** + `Walk.Spec()` + `search_test.go` (§3.10–3.12).
6. **`gitrpc`**: handler, wire type, switch arm, `ContractVersion` bump (§3.13–3.17). Manual smoke over a raw socket.
7. **`packages/git-ipc`**: the new member + `CONTRACT_VERSION = 26` (§4.1–4.2).
8. **`packages/git-ui`**: model/component/state/tests/`App.vue` wiring (§4.6–4.11).
9. **D10's differential run**, then the full check pass (§7).

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` passes, including every `gitsearch` unit test, `porcelain`'s scan-format tests, `scan_test.go`'s cancel/budget/limit cases and `gitrpc`'s socket end-to-end.
2. `conformance_test.go` and `conformance.test.ts` both pass over the same `searchConformance.json`, covering every rewrite-table row plus all eight `TOGGLE_ROWS`.
3. `KIRA_GIT_DIFFERENTIAL=1 go test ./apps/kira-studio/internal/gitsearch/ -run TestDifferential` passes on a fresh draw.
4. `bun run test:unit` passes, including the new conformance/`buildCommitHits`/`viewState` tests.
5. `bun run lint`, `bun run typecheck`, `bun run build:vscode` all pass. `bun run test:webview` passes **unchanged**.
6. `CONTRACT_VERSION` (TS) and `ContractVersion` (Go) are both **26**; the contract diff is exactly one new `SearchRunResult` member.
7. `grep -rn 'in G10, the tail scan' apps/` returns nothing.
8. An opt-in scan benchmark records records/sec, bytes, wall time for §9.

### 7.2 Tier 2 — reasoned check

9. The client's flow is correct by inspection; `buildCommitHits` now has a live, directly-tested tail branch.
10. A body-only hit on an already-loaded row renders `matched: body` without double-counting.

### 7.3 Tier 3 — needs a human on a Mac

11–16. Loaded/tail latency on a large repo; a body-only match; supersede (one spawn, not five); reveal navigation; the `unsupportedPattern` notice; toggle persistence across reload.

### 7.4 The checklist

- [ ] `search.run` is served.
- [ ] `LogScanArgs`/`LogSessionArgs` differ in exactly one argv token.
- [ ] `total` is exact past `limit`.
- [ ] A cancelled scan kills its child; no orphan process.
- [ ] Literal mode runs no regex engine.
- [ ] Whole-word agrees with JS on all four of probe 10's rows.
- [ ] Lookahead/lookbehind/backreference produce `unsupportedPattern`, never a smaller `ok`.
- [ ] `searchConformance.json` is read by both a Go test and a bun test.
- [ ] `CONTRACT_VERSION`/`ContractVersion` are both 26.
- [ ] `packages/git-core/src/search/` still has `query.ts` and `matcher.ts`.
- [ ] No file under `packages/git-ui/` changed except the §4.6–4.11 names.

---

## 8. Explicit non-goals for G23

- Passing the user's pattern to git (`--grep`/`-P`/`-E`) — ruled out on correctness and portability, measured slower.
- A `search.cancel` wire method — the existing per-request cancel frame suffices.
- A second walk session for search.
- Streaming search results (an `open`/`chunk` stream).
- PR number/title matching in the Refs scope — G24's.
- File-content search (`-S`/`-G`) — v2.
- Stash rows in the scan.
- Full JS-`RegExp` fidelity in regex mode — the fold delta is accepted (§10.3).
- Widening `compileQuery` to reject non-RE2 syntax client-side — argued and declined (§10.2).

---

## 9. Handed forward

- G24 owns the Refs scope's PR arm (`matcher.ts:226`'s `pr?` seam).
- `gitsearch` is the natural home for a future `-S`/`-G` pickaxe scan.
- The regex-mode fold delta (D4) is the one place the two engines knowingly disagree; local fix in `dialect.go` if ever reported.
- `searchConformance.json` is the contract for any future search change — a phase touching `SearchMatchField` or whole-word semantics adds rows there first.
- Measured scan numbers from §7.1(8) belong here once run.
- SPEC's G23 row's "(§8)" resolves to upstream's `docs/SPEC.md` §7.8, not a section of this repo's SPEC; this repo's binding statement is `docs/v1.3/SPEC.md:446-450`, and D3–D6 are its answer.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 A new `SearchRunResult` member (`unsupportedPattern`) and a `CONTRACT_VERSION` bump, versus reusing `invalidPattern`.** **Recommendation: add the member and bump to 26.** A silent smaller answer is the exact failure SPEC's open item forbids; the cost is one wire member, one model field, one template row, one `matchCount` clause.

**10.2 Where the dialect line is drawn: Go accommodates JS, rather than JS narrowing to RE2.** The symmetric alternative (make `compileQuery` refuse non-RE2 syntax, no bump needed) is rejected because it *removes a working capability* from the loaded-commit half, which runs fine in JS today. **Recommendation: keep the client permissive and the server honest.** If a human prefers the symmetric rule, it is a small, local, and *reversible* change — flagged explicitly because it inverts step 7 of §6.

**10.3 The one knowingly-accepted divergence: case folding inside a regex-mode pattern (the Kelvin-sign class).** **Recommendation: accept it, document it in `dialect.go`, and add a corpus row asserting the *literal* side stays exact.** Making regex mode exact would mean rewriting every literal run into an explicit character class — real work for an input almost nobody types.

**10.4 Wiring the four persisted search toggles (F11) — an upstream gap, not a port regression.** **Recommendation: do it.** The schema, validator and version bump already exist and are already carried through every write; the wiring is roughly ten lines in `App.vue`.

**10.5 No new Playwright spec.** **Recommendation: none**, required to pass unchanged. The visible surface is client-side and covered by `searchResultsModel`'s pure tests.

**10.6 A "Search History…" / focus palette command.** **Recommendation: do not add it.** Focusing an input is a keyboard-shortcut concern the webview already owns; a palette entry whose only effect is moving a text cursor is the kind of surface this chapter has consistently declined.

**10.7 Running the scan inside `Repo.Read`'s four-slot pool, holding a slot for up to 5 s.** **Recommendation: use the pool.** `logsession`'s direct-spawn exception exists specifically because a *paused* process would hold a slot forever; a scan terminates and is exactly the bounded read the pool is for.

**10.8 The scan uses the connection's current graph walk spec, with no `scope` on the wire.** **Recommendation: keep it**, with the documented fallback for a client that calls `search.run` before opening a graph walk. Matches upstream and is what makes every hit revealable.

**10.9 The differential fuzz test is opt-in rather than part of `go test ./...`.** **Recommendation: opt-in**, matching G3 D22's own posture, with one required green run per phase touching `gitsearch`.
