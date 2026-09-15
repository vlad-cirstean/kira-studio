# P69c — `codeparse`: cancelling a parse mid-flight aborts the process

Plan for SPEC row P69c. Closes the non-trivial dogfooding finding in
`docs/v1.6/mcp-repo-map-issues.md` ("P69b (planning) — `TestParseConcurrentCancellationDoesNotCrash`
aborts the whole `codeparse` test binary on a tree-sitter C assertion").

Written against HEAD `28edadc7`, branch `v1.6`. Every claim about `go-tree-sitter` below is read out
of the pinned v0.25.0 source, and every number is measured on this worktree during this planning
pass, not estimated.

**Why this plan is long.** P69's own fix pass already "fixed" this bug once (`b412286b`), verified
it with 40+ repeated `-race` runs, and shipped a tree that still aborts. That fix changed which API
was called without establishing what the C library actually requires. This plan therefore spends its
length on the library contract and on proof, not on describing code edits — the edit is ~12 lines.

## 1. Problem

`go test -count=1 -run TestParseConcurrentCancellationDoesNotCrash ./internal/codeparse/` kills the
test binary:

```
codeparse.test: .../go-tree-sitter@v0.25.0/src/./parser.c:2197:
    ts_parser_parse: Assertion `self->finished_tree.ptr' failed.
SIGABRT: abort — signal arrived during cgo execution
```

Reproduced this pass on `28edadc7`: **3 of 4** isolated runs. Stack rooted in `session.go`'s
`parseWithOptions`, the function `b412286b` wrote.

This is not test-only. `Session.Parse`/`Reparse` is the live indexing path, and the context that
gets cancelled is a real one — see §6.

## 2. What the C library actually requires

All references are `$(go env GOPATH)/pkg/mod/github.com/tree-sitter/go-tree-sitter@v0.25.0`.

### 2.1 How a cancelled parse leaves the parser

`ts_parser_parse` (`src/parser.c:2087-2217`) has exactly two cancellation exits, and **neither runs
`ts_parser_reset`**:

| Exit | Line | State left behind |
| --- | --- | --- |
| Cancelled inside the parse loop (`ts_parser__advance` returns false, no scanner error) | `2158-2161` `return NULL` | Partial stack, retained `old_tree`, live external scanner. `canceled_balancing` still false. |
| Cancelled inside the balancing phase (`ts_parser__balance_subtree` returns false) | `2198-2201` `self->canceled_balancing = true; return false;` | All of the above **plus `canceled_balancing = true` and a non-NULL `finished_tree`**. |

Every other exit reaches `exit:` at `2214`, which does run `ts_parser_reset(self)`. A parse that
returns a tree also clears `canceled_balancing` explicitly at `2202` before reaching `exit:`.

Both cancellation exits are driven by one function, `ts_parser__check_progress` (`1532-1556`): it
returns false when the cancellation flag is set, when `end_clock` has passed, **or when
`parse_options.progress_callback` returns true** (`1547`). The progress callback is therefore not a
different mechanism from the deprecated cancellation flag — it is the same mechanism behind a
different setter. That alone is why `b412286b` could not have fixed anything.

### 2.2 How the next parse on that parser reaches the assertion

`ts_parser_parse` opens by asking whether a previous parse is still outstanding (`2111-2113`):

```c
if (ts_parser_has_outstanding_parse(self)) {
  LOG("resume_parsing");
  if (self->canceled_balancing) goto balance;
}
```

`ts_parser_has_outstanding_parse` (`1919-1925`) returns true if **any** of: `canceled_balancing`, a
live `external_scanner_payload`, a stack not in its initial state, or nodes pushed since the last
error. `balance:` begins with `ts_assert(self->finished_tree.ptr)` at `2197`.

So the abort needs `canceled_balancing == true` while `finished_tree.ptr == NULL`.

### 2.3 `Reset()` is what creates that combination

`ts_parser_reset` (`2061-2085`) releases `finished_tree` and sets it to `NULL_SUBTREE`
(`2076-2079`), clears the stack, destroys the external scanner — **and never touches
`canceled_balancing`.** Grepping the whole file, `canceled_balancing` is written in exactly three
places: `ts_parser_new` (`1945`), and lines `2199`/`2202` inside `ts_parser_parse` itself.

`session.go:187` calls `p.Reset()` on every check-in, with the comment "clears any cancellation flag
left over from a cancelled parse before reuse." That comment is false, and it is the belief this
whole bug rests on. The crash sequence is:

1. A parse is cancelled during balancing → `canceled_balancing = true`, `finished_tree` non-NULL, no
   reset.
2. `Parse` returns an error; the `defer`red `checkinParser` runs `p.Reset()` → `finished_tree`
   released and NULLed, `canceled_balancing` left true.
3. The parser goes back in the pool. Any later `Parse` on it takes `goto balance` and trips
   `ts_assert(self->finished_tree.ptr)` → SIGABRT.

**The assertion is purely a parser-reuse hazard.** It cannot fire within a single parse on a clean
parser: the parse-loop cancel path returns at `2160` without ever reaching `balance:`, and the
fall-through into `balance:` only happens after a version accepted, which is what sets
`finished_tree` (`1083-1091`). This is the same "stale state leaks onto a reused parser" shape the
P69 review named as `ParseCtx`'s second-order hazard. It survived because the review's fix addressed
only the first-order one.

### 2.4 There is no way to clean a poisoned parser through the public API

`canceled_balancing` has no public setter. `ts_parser_reset` does not clear it.
`ts_parser_set_language` (`1986`) just calls `ts_parser_reset`, so it does not either. The only
public function that clears it is `ts_parser_parse` completing a parse successfully — which the
assertion prevents.

A parser cancelled during balancing is therefore **unrecoverable in-place**. It can only be deleted.
`ts_parser_delete` (`1956-1979`) starts with `ts_parser_set_language(self, NULL)` →
`ts_parser_reset`, so deleting a poisoned parser releases its `finished_tree`, `old_tree` and
external scanner with no leak.

### 2.5 Measured proof of all of the above

Throwaway probe (deleted before this commit): parse `largeGoSource(300)` with a `ProgressCallback`
that returns true at the **k-th** invocation, then do one of three things to the parser, then parse
again on it and check the second tree. A full uncancelled parse makes exactly **456** progress
checkpoints, so sweeping k over 1..456 walks the cancellation point across the entire parse
deterministically. Second parse uses *different* source, so a resumed parse is detectable.

| k range | Phase |
| --- | --- |
| 1-300 | parse loop |
| 301-456 | balancing (34% of all checkpoints) |

| After-cancel handling | aborts | wrong tree | clean |
| --- | --- | --- | --- |
| `p.Reset()` then reuse — **today's code** | **156** (every k ≥ 301) | 0 | 300 |
| no reset, reuse anyway | 0 | **416** | 40 |
| `p.Close()`, use a fresh parser — **this plan** | 0 | 0 | **456** |

Three things this settles:

- The abort is fully deterministic given the cancellation phase, not a race. The existing test looks
  flaky only because a 1 ms timeout lands in balancing some fraction of the time — which matches the
  finding's observed "4/4 isolated, roughly 2 in 3 in a package run" and the 34% checkpoint share.
- **Simply deleting `p.Reset()` is not a fix.** It trades the abort for silent corruption: the
  resumed parse returns the *previous* file's tree for 416 of 456 cancellation points. A crash is
  loud; this would have been indexed as real data. Any plan that stops at "stop calling Reset" is
  worse than the bug.
- Discarding the parser is clean at every one of the 456 cancellation points.

## 3. Options evaluated

**Upgrade `go-tree-sitter`.** Not available. `proxy.golang.org/.../@v/list` returns exactly `v0.23.0
v0.23.1 v0.24.0 v0.25.0` — v0.25.0 is the newest published version. Nothing to upgrade to.

**Use a different parse entry point.** There is none that avoids this. Every `Parse*` variant
funnels into `ts_parser_parse`, and both cancellation sources (progress callback, deprecated
cancellation flag, and `SetTimeoutMicros`'s `end_clock`) funnel into the same
`ts_parser__check_progress` return at `1547`. The hazard belongs to cancellation itself, not to any
one wrapper.

**Never cancel mid-parse; only check `ctx` between parses.** This does eliminate the hazard — an
uncancelled parse never leaves outstanding state. Rejected as the *sole* mechanism: it makes
cancellation latency equal to one whole file's parse, and it silently re-opens the same crash the
moment anyone adds `SetTimeoutMicros` or a future caller passes a deadline, because nothing in the
code would encode why cancellation is forbidden. Adopted as a cheap *second* layer instead (§4,
commit 2) — it is worth having, just not as the safety property.

**Discard the parser after any cancelled parse.** Chosen. See §4.

## 4. The fix

Two commits. The first is the correctness fix; the second is an efficiency guard that is not
load-bearing for safety.

### Commit 1 — `fix(codeparse): close a parser whose parse was cancelled instead of pooling it`

In `internal/codeparse/session.go`:

- `Parse`: drop `defer s.checkinParser(...)`. On `parseWithOptions` error, call `parser.Close()` and
  return. On success, call `s.checkinParser(...)` immediately — `extract` does not touch the parser,
  so nothing after that point needs it.
- `Reparse`: same shape. Move `checkoutParser` to **after** the `DeriveEdit`/`hasEdit` check so the
  byte-identical path never checks a parser out at all; on parse error `parser.Close()` alongside
  the existing `entry.tree.Close()`.
- `checkinParser`: delete the `p.Reset()` call. It is not merely redundant now — its doc comment
  asserts a safety property the library does not provide (§2.3), and leaving that comment in place
  is exactly how this bug survived P69. Replace with a comment stating the real invariant.

The invariant to document on `checkinParser`, in these terms:

> A parser reaches here only after a parse that returned a tree. `ts_parser_parse` runs
> `ts_parser_reset` on its own `exit:` path and clears `canceled_balancing` before it, so such a
> parser is clean. A parse that returned nil may have been cancelled, and a cancelled parse leaves
> state (`canceled_balancing`) that no public API can clear — that parser is Closed, never pooled.

`parseWithOptions`'s own doc comment must be corrected too: its current claim that ProgressCallback
"runs synchronously inside the parse call itself instead, so … there is nothing left to write to
after the parse returns" is true but irrelevant, and reads as a safety argument. State instead that
the progress callback is the same `ts_parser__check_progress` mechanism as the deprecated
cancellation flag, that cancelling by any means abandons the parse without a reset, and that the
caller must discard the parser.

**Why this is provably complete, not a narrower window.** The precise claim is:

> `tree != nil` ⟹ the parser is clean. `tree == nil` ⟹ the parser is discarded.

The first half holds because every non-NULL return from `ts_parser_parse` passes through `2202`
(`canceled_balancing = false`) and `2214` (`ts_parser_reset`). The second half is unconditional in
the new code. Together they mean no parse ever begins on a parser carrying state from a previous
parse. `has_outstanding_parse` is false on every checked-out parser, so `goto balance` at `2113` is
unreachable and the assertion at `2197` cannot be evaluated with a NULL `finished_tree`. The
resumed-parse corruption path of §2.5 is closed by the same argument.

This is a claim about reachability of a `goto`, not about timing. That is the difference from
`b412286b`, which argued that a goroutine could no longer outlive the parse — true, and orthogonal
to where the state was actually going.

**Cost.** One parser allocation per cancelled parse. `sitter.NewParser()` + `SetLanguage` is a
`ts_calloc` plus pointer stores. Cancellations happen on revoke/quit and on a watcher context
teardown; during a normal Sync there are none. The pool is a per-grammar free list with no size
bound, so it refills on demand and shrinking it costs nothing. No measurement is warranted here: the
operation is a struct allocation against a parse that just did thousands of checkpoints, and no
decision changes on the answer.

### Commit 2 — `fix(codeparse): skip a parse whose context is already cancelled`

Add `if err := ctx.Err(); err != nil { return Result{}, err }` at the top of both `Parse` and
`Reparse`, before `checkoutParser` and before `cacheTake`.

Not needed for safety. It matters because `codeindex`'s Sync workers do not break out of their job
loop on cancellation (§6), so after a cancel every remaining file still calls `Reparse`, each parse
runs to its first checkpoint, returns nil, and — with commit 1 in place — burns a parser. This turns
that into a cheap early return. It also keeps `Session` honest about what "cancelled" means at the
API boundary. Existing `TestReparseCancelledContextReturnsError` already asserts the error, so the
behaviour is unchanged for callers.

### Commit 3 — `test(codeparse): cover parser reuse after a cancelled parse`

See §7.

### Commit 4 — `docs(P69c): close the codeparse cancel-mid-parse crash finding`

Update `docs/v1.6/mcp-repo-map-issues.md`'s entry from **Open** to **Fixed (`<sha>`)**, following
the format the P69b and P67e entries already use: retitle the bullet, then a `**Fix (P69c, …)**:`
paragraph giving the mechanism in two or three sentences (Reset nulls `finished_tree` and leaves
`canceled_balancing` set; a pooled parser then jumps to `balance:` and asserts), the fix in one
sentence, and the verification numbers from §8. Keep the original repro block — it is what makes the
entry legible later.

## 5. Explicitly not in this phase

- The `go-tree-sitter` v0.25.0 `pointer.Save(options)` leak (`parser.go:350`, and the same at `477`,
  `548`, `631`, `query.go:788`): saved into the global `mattn/go-pointer` map with no matching
  `Unref`, unlike the input payload two lines above which is properly `defer`red. Every
  `ParseWithOptions` call therefore leaks one `C.malloc(1)` plus a permanent map entry retaining the
  `*ParseOptions` and its closure — unbounded in a long-lived indexing process, under a global mutex
  every parse contends on. Logged as its own finding; out of scope here per CLAUDE.md's dogfooding
  rule. Commit 2 reduces the rate but does not address it.
- The `find_references` `file`-scoping defect found while navigating during this pass (§9). Logged,
  not fixed.

## 6. Where else this is reachable

Checked every caller. `Session.Parse`/`Reparse` has exactly one non-test caller chain.

- **`internal/codeindex/sync.go:412`** — `parseOne` → `session.Reparse(ctx, …)`, run from
  `syncWorkers()` goroutines (`sync.go:240-253`). The worker loop is `for j := range jobs { …
  parseOne(ctx, …) }` and **does not check `ctx` itself** — it keeps pulling jobs until `jobs`
  closes or `writerCtx` fires. So after a cancel, every worker keeps calling `Reparse` on the shared
  `Session`. The parses actually in flight at cancel time are the ones that can land in balancing;
  each poisons a parser, which the next worker then checks out. This is the live crash, and it needs
  several workers sharing a pool — exactly what the existing test models.
- **`internal/codeindex/watch.go:240`, `sync.go:172`** — `session.Forget`, cache-only, no parser.
  `handleFiring` → `reparseChangedPath` → `parseOne` reaches `Reparse` on the watcher's own
  long-lived ctx (`watch.go:55-63`), which is cancelled on Close/revoke. Same hazard, and it shares
  the pool with the Sync workers above.
- **`internal/repomap/instance.go`** — `inst.cancel()` on Detach/revoke/app-quit is the origin of
  the cancellation. The comment at `instance.go:60-66` already states that "a parse worker mid
  `idx.session.Reparse` finishes that call before honouring ctx, so idx.Sync can still be running —
  and still checking tree-sitter parsers in and out of `codeparse.Session`'s pool — for a while
  after `cancel()` returns." That is an accurate description of the crash window, written before
  anyone knew it was one.

No other package touches a `*sitter.Parser`. `Session.Close` is already documented as not
concurrency-safe with an in-flight parse, and `instance.close()` waits on `syncDone` first, so
commit 1 introduces no new interaction there.

Conclusion: the shipped path is Settings revoke or app quit racing a running index, precisely as the
SPEC row states. No further call sites to fix.

## 7. Regression test

Keep it permanently. This exact surface has now produced two distinct process-killing bugs in two
consecutive phases; it is the clearest case in this repo for the "genuinely hard to get right"
exemption in CLAUDE.md's unit-test bar, and it is cheap (~3 s).

Keep `TestParseConcurrentCancellationDoesNotCrash` as-is — it is the realistic-shape test and it
caught both bugs. Fix its doc comment, which currently narrates the `ParseCtx` SIGSEGV as the thing
being guarded; add the balancing-phase assertion as the second.

Add one new test alongside it. The existing test asserts only "the binary survived", which by §2.5
would **not** catch the silent-corruption variant. The new test must catch both. Validated during
this pass; the implementer should land essentially this:

- Parse a small file cleanly, keep its symbol count and line count as the expected answer.
- Time one full uncancelled parse of a large file to get its duration.
- Sweep a `context.WithTimeout` deadline in 200 steps across that duration, so cancellation lands
  everywhere from the first checkpoint to the balancing phase rather than only at "immediately".
- After **every** step, regardless of whether it cancelled, do a clean `Parse` of the small file on
  the same `Session` and assert the result matches the expected answer and has no ERROR nodes. That
  is the assertion that catches a resumed parse returning the wrong file's tree.
- Fail if zero steps actually cancelled, so the test cannot silently stop exercising anything.

Measured behaviour of that test: ~100 of 200 steps cancel. On `28edadc7` it aborts on the assertion
**3 of 3** runs — more reliable than the existing test's 3 of 4. With commit 1 applied it passes 3
of 3, and the `t.Logf` cancellation count stays around 100.

Do not add a unit test for `checkinParser`/`checkoutParser` in isolation; there is no logic there to
test, and the pool's real contract is what the two tests above exercise.

## 8. Verification

Run in this order, all in `apps/kira-studio`.

1. `go build ./... && go vet ./internal/codeparse/`.
2. New test against `28edadc7` before applying commit 1 — confirm it aborts. If it does not, the
   commit is not testing the bug.
3. `go test -count=1 -run
   'TestParseConcurrentCancellationDoesNotCrash|TestParseAfterCancelledParseIsCorrect'
   ./internal/codeparse/`, **250 isolated invocations**, zero failures required. Isolated
   invocations, not `-count=250`: the failure mode is a process abort, so one crash inside a single
   `-count=N` run ends the whole run and hides how many iterations actually ran. The bar is
   deliberately well above the 40 runs that gave false confidence in P69 — and, more to the point,
   the §2.5 sweep is the real proof, with the repeated runs confirming the natural-timing path
   agrees with it.
4. `go test -race -count=20 ./internal/codeparse/`.
5. `go test -race -count=5 ./internal/codeindex/ ./internal/repomap/`.
6. Full `go test ./...` once at phase end.

Already measured this pass on the candidate fix, for the implementer to reproduce rather than
rediscover:

| Check | Result |
| --- | --- |
| §2.5 sweep, k = 1..456, close-on-cancel | 456/456 clean, 0 aborts, 0 wrong trees |
| 200 isolated runs, `TestParseConcurrentCancellationDoesNotCrash` | 0 failures (baseline: 3/4 runs abort) |
| `go test -race -count=20 ./internal/codeparse/` | ok, 152 s |
| `go test -race -count=5 ./internal/codeparse/ ./internal/codeindex/` | both ok |
| New regression test, pre-fix | aborts 3/3 |
| New regression test, post-fix | passes 3/3, ~100/200 steps cancelling |
| All four changes together, in a clean `28edadc7` worktree: 40 isolated runs of both tests | 0 failures |
| All four changes together: `go test -race -count=5 ./internal/codeparse/ ./internal/codeindex/` | both ok |

The last two rows are the plan's exact proposed shape — all four changes, applied to a throwaway
worktree checked out at `28edadc7` — so the implementer is reproducing a measured design, not
trying one. Step 3's own 250-run figure is the one number to produce fresh, against the committed
tree.

## 9. New finding logged this pass

Navigating with the repo-map server during this investigation surfaced an unrelated non-trivial
defect: `find_references`'s `file` argument does not scope results to the definition in that file.
Headline repro, both against a live server on this tree:

- `find_references {"symbol":"Forget"}` → **6 correct references**.
- the same call with `"file":"apps/kira-studio/internal/codeparse/session.go","line":102` added — the
  file and line of `Forget`'s own definition — → **`no references found`**.

Adding the documented disambiguator — the one the tool's own ambiguity message tells you to add —
turns a correct answer into an empty one. In the other direction it fails to filter at all:
`find_references` for `Parse` with `file`+`line` pointing exactly at `session.go:194`'s definition
returns **38** hits led by `flag.Parse()`, `url.Parse()` and `time.Parse()`. Separately,
`languages:["go"]` on `Close` reports **35** candidate symbols where the unfiltered call reports
**25** — a filter that widens its own candidate set — and the accepted spelling is silently
case-sensitive (`"Go"` yields `no references found`, `"go"` works).

Logged in full in `docs/v1.6/mcp-repo-map-issues.md`. Not this phase's work.

## 10. Commit list

1. `fix(codeparse): close a parser whose parse was cancelled instead of pooling it`
2. `fix(codeparse): skip a parse whose context is already cancelled`
3. `test(codeparse): cover parser reuse after a cancelled parse`
4. `docs(P69c): close the codeparse cancel-mid-parse crash finding`

No `ARCHITECTURE.md` "Known open items" entry is added — the limitation is closed, not carried. If
the `pointer.Save` leak of §5 is judged to warrant one, that belongs to the phase that takes it on,
not here.
