# P64c — Repo-map MCP: make a full parse-from-scratch fast

One mandate (`docs/v1.6/SPEC.md`'s P64c row): **a full parse of this repository, from nothing,
should take seconds, not minutes.** How often a full reparse is *triggered* is explicitly not this
row's concern. Only the parse-and-write pipeline's own raw throughput is.

Everything below is measured on the live tree at `0ee62126` (branch `v1.6`), in this container, with
a throwaway in-package profiling harness (`internal/codeindex/zzprofile*_test.go`, written, run, and
deleted — it is not part of the deliverable; §4 proposes what of it earns a permanent home). Numbers
are wall-clock from real runs against this repository's own 1845 enumerated files, not estimates.

Environment for every number here: **4 CPUs** (`nproc` = 4), Go 1.27.1 linux/amd64,
`modernc.org/sqlite v1.58.0`, `codeindex.db` on a fresh `t.TempDir()` per run.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Does a full parse of this repo actually take minutes? | **No.** Measured in isolation: **3.45s** total — enumerate 7ms, parse 1.76s, write 1.68s, over 1845 files / 18,187 symbols / 134,218 references. The SPEC row's target ("seconds") is **already met** by the pipeline itself | §1.1 |
| Then where did the observed minutes come from? | Three causes, none of them pipeline throughput: a **cold cgo rebuild of the server, 34.1s measured**, counted as part of "reindex"; **CPU starvation** from this session's concurrent agents on a 4-CPU box (parse is CPU-bound and scales 3.4x to 4 workers, so lost CPU multiplies wall time directly); and repeated full Syncs from several server instances | §1.2 |
| Is the pipeline single-threaded? | **No** — the goroutine-dump reading was wrong. `parseStale` (`sync.go:135`) already runs a 4-worker pool over a thread-safe `codeparse.Session` with a per-grammar parser free list. Parse scales 5.55s → 1.63s from 1 to 4 workers | §1.3 |
| Would more goroutines help? | **No.** 4 → 8 → 16 workers: 1.632s / 1.593s / 1.632s. Flat, because `syncWorkers()` already returns `NumCPU`=4 here. Declined with numbers | §6.1 |
| Are SQLite writes batched into transactions? | **Yes**, already — 256 files per transaction with tx-scoped prepared statements (`store.go:118`, `store.go:157`). Batch tuning is exhausted: 256 → 1024 → one-giant-tx is 1.627s / 1.614s / 1.621s, under 1% | §1.4, §6.2 |
| Then what dominates the write phase? | **`insertRef`: 1.276s of 1.60s (80%)** — 134,415 reference rows, 7.4x the symbol count. Of that, ~59% is B-tree maintenance on the table's two indexes, not the insert itself | §1.4 |
| Is the `SQLITE_BUSY` contention structural, or a one-off from this session? | **Overwhelmingly a one-off.** 4 concurrent writers on one `codeindex.db` produced **zero** errors — they simply serialize. BUSY reproduces only when a writer holds the write lock **longer than `busy_timeout` (5s)**; a normal 256-file batch commits in ~200ms. It needed this session's CPU starvation to stretch a transaction past 5s | §1.5 |
| Any structural gap left in that area? | Two small, honest ones: nothing anywhere retries on BUSY, and `repomap/server.go:170` arms the watcher *before* the initial Sync finishes, so watcher writes can interleave with it. Both are real but neither caused the observed slowness | §1.5, §2.3 |
| Is the DSN actually applying WAL/`busy_timeout`? | **Yes** — verified on a live connection, not assumed: `journal_mode=wal`, `synchronous=1` (NORMAL), `busy_timeout=5000`, `foreign_keys=1`. A plausible bug (mattn-style DSN keys against the modernc driver) was checked and **disproved** | §1.6, §6.6 |
| So is there any real throughput win left? | **One.** Parse and write are strictly sequential phases today — all 1845 files parse, *then* all rows write. Overlapping them measures **3.51s → 2.30s (-34.5%)** and drops peak retained heap from **153 MiB** to about one batch | §1.7, §2.1 |
| How much further could it go? | Little. SQLite is single-writer by construction, so with parse 1.76s and write 1.68s the pipelined floor is ~max(parse, write) ≈ 1.8s. 2.30s is already close to it | §2.2 |
| Incremental/partial reindex? | **Declined by scope**, citing the SPEC row directly | §6.8 |

### 0.1 Sequencing gate — read before starting

`docs/v1.6/mcp-repo-map-issues.md` currently has **no open non-trivial entry**: both are closed —
the TypeScript type-alias gap (fixed in P64, `54e77579`) and the bare-symbol ambiguous listing
(resolved in P64b as not-a-defect, docs-only). The log's process rule — the next phase waits on a
dedicated fix pass for any open non-trivial entry — is satisfied. P64c starts clean.

### 0.2 An honest statement of what this phase is

Per `CLAUDE.md` ("a pass finding nothing real should say so, not manufacture a finding"): **the
premise that provoked this row is not reproducible as stated.** A full parse of this repository
takes 3.45 seconds, not minutes. The SPEC row's own target is already met.

This plan does not pad that into a crisis. It proposes exactly one substantive change — the one
lever that measures a real, repeatable win (§2.1) — plus one small resilience fix for a structural
gap the investigation genuinely did find (§2.3). Everything else investigated is declined **with
the measurement that declined it** (§6). A reviewer should be able to reject §2.1 and still find
this phase's main value in §1: a correct, measured account replacing an incorrect diagnosis.

## 1. Confirmed current state — measured, not inferred

### 1.1 A cold full Sync of this repository: 3.45s

Phases instrumented individually around the real `Sync` body (`sync.go:48`), fresh `codeindex.db`,
nothing cached:

```
enumerated=1845 files
writes=1845  symbols=18187  refs=134218  blocks=936
PHASE enumerate    = 7ms
PHASE listFiles    = 0s
PHASE parseStale   = 1.764s
PHASE replaceFiles = 1.675s
PHASE total        = 3.452s
```

Language mix, from the same run:

```
go 817   typescript 716   vue 191   html 51   json 43   css 17
javascript 6   java 1   rust 1   svelte 1   python 1
```

Two phases are already free: `git ls-files` enumeration is 7ms, and `ListFiles` on an empty table is
below the timer's resolution. **All of the cost is parse (51%) and write (49%)**, split almost
evenly.

### 1.2 Where the observed "multiple minutes" actually came from

Three measured contributors, none of which is the pipeline:

**A cold cgo build is 34.1s.** With the build cache cleared:

```
$ go build -o apps/kira-studio/bin/kira-repo-map ./apps/kira-studio/cmd/kira-repo-map
real 0m34.105s   user 1m41.111s   sys 0m12.597s
```

Restarting the server to test a change pays this before a single file is parsed. Observed as
"the reindex is taking forever", it is the grammar compile, not the index.

**Parse is CPU-bound on a 4-CPU box.** §1.3's scaling table shows parse time is almost exactly
inversely proportional to available cores. This session ran several agents concurrently in one
container; every core taken elsewhere stretches the 1.76s parse phase proportionally. A 4x CPU
shortfall alone turns 3.45s into ~14s, and that compounds with repeated Syncs below.

**Several server instances, each doing its own full Sync.** `docs/ARCHITECTURE.md` (line ~871)
records that two repo-map instances can open `codeindex.db` at once, and the per-repository flock
(`codeindex.AcquireSyncLock`) covers **the initial Sync only** — a watcher-driven rescan or a
`parser_fingerprint` mismatch reparse runs outside it. P64b changed query files, which changes
`Fingerprint()` and forces a truncate-and-rebuild (`checkFingerprint`, `sync.go:343`) on every
instance that opens the file. Several rebuilds, on a starved CPU, is the observed condition.

None of these is raw throughput, and none is fixed by parallelism.

### 1.3 The pipeline is already parallel — the dump reading was wrong

`parseStale` (`sync.go:135`) runs a bounded worker pool: `syncWorkers()` (`sync.go:27`) workers,
each pulling from a `jobs` channel and pushing to an `outcomes` channel, drained single-threaded by
the caller. `syncWorkers()` returns `min(NumCPU, 4)` — **4 on this box, i.e. already `NumCPU`**.

The shared `*codeparse.Session` is genuinely concurrency-safe, which is what makes that pool legal:
`checkoutParser`/`checkinParser` (`session.go:156`, `session.go:178`) keep a per-grammar free list of
`*sitter.Parser` under `parserMu`, so no parser instance is ever used by two goroutines at once —
the exact constraint the SPEC row asked about, already honoured. The resident-tree LRU is guarded
separately by `cacheMu`. Compiled queries are cached process-wide behind `queryCacheMu`
(`queries.go:97`), so no query is recompiled per file.

Measured scaling, parse only, no DB writes, 15,866,298 bytes of source:

| workers | elapsed |
|---|---|
| 1 | 5.547s |
| 2 | 2.894s |
| 4 | **1.632s** |
| 8 | 1.593s |
| 16 | 1.632s |

3.4x from 1 to 4 workers, then flat — textbook CPU saturation at 4 cores. The pool works. There is
no shared non-thread-safe resource serializing it, and no deadlock. A goroutine dump taken while 4
workers were blocked on channel sends behind one slow writer would *look* single-threaded without
being so.

### 1.4 The write phase: `insertRef` is 80% of it

Per-statement-class timing inside one transaction over the whole repository's writes
(files=1846, blocks=936, symbols=18,193, parent-links=1983, refs=134,415 — 159,219 statements):

| statement class | time | share |
|---|---|---|
| `insertRef` | **1.276s** | **80%** |
| `insertSymbol` | 184ms | 11% |
| commit | 83ms | 5% |
| `updateParent` | 26ms | 2% |
| `insertFile` | 20ms | 1% |
| `deleteFile` | 7ms | <1% |
| `insertBlock` | 5ms | <1% |

References are 7.4x the symbol count (134,415 vs 18,193), and that ratio — not any inefficiency in
the statement — is why they dominate. The two-pass parent-link design (`store.go:286`) that looks
expensive costs 26ms; it is not a problem.

Decomposing the reference insert further, same 134,503 rows, each variant a fresh database:

| variant | insert | build index after | total |
|---|---|---|---|
| A — `AUTOINCREMENT` + 2 indexes (**today**) | 1.432s | — | **1.432s** |
| B — plain rowid PK + 2 indexes | 1.419s | — | 1.419s |
| C — `AUTOINCREMENT`, no indexes | 590ms | — | 590ms |
| D — plain rowid PK, no indexes | 517ms | — | 517ms |
| E — rowid PK, indexes built after load | 511ms | 423ms | 934ms |
| F — as today, `foreign_keys=OFF` | 1.479s | — | 1.479s |

Read off directly: **index maintenance during insert is ~59% of reference-write cost**
(1.432s → 590ms when the two indexes are absent). `AUTOINCREMENT` costs ~1% (A vs B) and foreign-key
enforcement costs nothing measurable (F vs A, inside noise). §6.3/§6.4 decline both accordingly, and
§6.5 declines the deferred-index build in E despite it being the second-largest lever, for a
correctness reason.

### 1.5 `SQLITE_BUSY`: a one-off from this session, with two small structural gaps

The DSN already sets `_busy_timeout=5000` and it is live (§1.6). Two experiments settle the
question.

**Concurrent writers do not produce BUSY.** N independent `*sql.DB` pools against the same
`codeindex.db` file, each writing 400 files' worth of rows under its own `repo_id` — the shape of N
repo-map instances indexing at once:

| writers | elapsed | errors |
|---|---|---|
| 1 | 189ms | **0** |
| 2 | 382ms | **0** |
| 4 | 954ms | **0** |

Zero errors. Elapsed scales linearly, which is exactly right: SQLite admits one writer at a time, so
they serialize cleanly behind the busy timeout rather than failing.

**BUSY appears only past the 5s timeout.** One connection holds the write lock for a fixed duration
while another attempts a write:

| lock held | competing write waited | result |
|---|---|---|
| 1s | 1s | success, no error |
| 6s | 5s | **`database is locked (5) (SQLITE_BUSY)`** |

That is the exact error string from the session's log, and it reproduces only when a single
transaction holds the write lock longer than `busy_timeout`. A normal 256-file batch commits in
~200ms (189ms above). Getting past 5s requires a transaction stretched ~25x — which is what CPU
starvation plus several concurrent rebuilds did.

**Verdict: not a structural design bug.** The design is correct for its intended concurrency; the
session hit a pathological load. Two genuine gaps remain, neither responsible for the slowness:

1. **Nothing retries on BUSY.** `ReplaceFiles` (`store.go:118`) surfaces the error, aborting the
   Sync pass. Past the timeout, a whole reindex is lost rather than deferred. §2.3 fixes this.
2. **The watcher is armed before the initial Sync completes.** `repomap/server.go:168` launches
   `runInitialSync` in a goroutine and `server.go:170` immediately calls `idx.Watch()`, so
   watcher-driven `GetFile`/`ReplaceFile` writes can interleave with the initial full Sync's
   transactions. Noted for the record; §6.7 declines changing it, with reasoning.

The watcher itself is not a source of churn worth fixing: `newBackend` (`watch_fsnotify.go:39`)
adds watch descriptors only to directories that contain enumerated files, so `node_modules`,
`target` and every ignored tree get none. Build output lands in `apps/kira-studio/bin/`, which is
gitignored (`apps/kira-studio/.gitignore:2`) and therefore never enumerated and never watched.

### 1.6 The DSN works — a plausible bug, checked and disproved

`buildDSN` (`db.go:43`) sets `_busy_timeout`, `_journal_mode`, `_synchronous`, `_foreign_keys` and
`_auto_vacuum` as bare shorthand keys. Those are `github.com/mattn/go-sqlite3`'s spelling; this app
uses `modernc.org/sqlite`, which is documented mainly around `_pragma=`. If the shorthand keys were
silently ignored, the database would be in rollback-journal mode with `synchronous=FULL` and **no**
busy timeout — which would explain both slow commits and the BUSY errors at once. It was the single
most promising hypothesis in this investigation.

It is wrong. Read back from a live connection opened through `Store.conn()`:

```
PRAGMA journal_mode        = wal
PRAGMA synchronous         = 1      (NORMAL)
PRAGMA busy_timeout        = 5000
PRAGMA foreign_keys        = 1
PRAGMA auto_vacuum         = 2      (INCREMENTAL)
PRAGMA page_size           = 4096
PRAGMA cache_size          = -2000
PRAGMA wal_autocheckpoint  = 1000
```

Every intended pragma is in force. `modernc.org/sqlite` v1.58.0 implements the mattn shorthand keys
deliberately — `applyQueryParams` (`sqlite.go:285`) validates and applies `_busy_timeout`/`_timeout`,
`_journal_mode`/`_journal`, `_synchronous`/`_sync`, `_auto_vacuum`/`_vacuum` and
`_foreign_keys`/`_fk`, explicitly "against the same set `github.com/mattn/go-sqlite3` accepts". No
change needed. Recorded here so the next reader does not re-raise it. §6.6 keeps the declined entry.

### 1.7 The one real inefficiency: parse and write never overlap

`Sync` (`sync.go:79`) calls `parseStale` to completion, collecting **every** `FileWrite` into one
slice, and only then calls `ReplaceFiles` (`sync.go:83`). Parse workers finish and idle while the
writer runs; the writer sits idle for the whole parse. The two phases are 1.76s and 1.68s — almost
perfectly balanced, which is the best possible case for overlapping them.

Measured, three runs each, same repository, fresh database per run:

| run | sequential (today) | pipelined |
|---|---|---|
| 1 | 3.656s | 2.480s |
| 2 | 3.357s | 2.221s |
| 3 | 3.513s | 2.192s |
| **mean** | **3.509s** | **2.298s** |

**-34.5%**, consistent across runs.

There is a second, independent benefit. Accumulating every `FileWrite` before writing retains the
whole repository's parse output — 134k references and 18k symbols, each with its own strings — on
the heap at once:

```
files=1847  retained heap = 153.1 MiB
```

153 MiB held live, in a background index of a mid-sized repository, on top of the resident-tree
cache's own 16 MiB budget. Pipelining bounds it to one batch in flight (256 files) plus the channel
buffer — roughly two orders of magnitude less for the same work.

## 2. The fix

### 2.1 Pipeline the writer against the parse workers

**Root cause, stated once**: `Sync` runs parse and write as two strictly ordered phases over a
fully-materialized intermediate slice. Both phases cost ~1.7s; neither can start before the other
finishes. Overlapping them recovers the smaller of the two.

Change `Sync`/`parseStale` in `apps/kira-studio/internal/codeindex/sync.go` so that:

- `parseStale`'s worker pool emits each `FileWrite` onto a buffered channel as it completes, instead
  of appending to a slice the caller drains afterwards.
- One dedicated writer goroutine — **exactly one**, preserving today's "nothing writes to the store
  concurrently" invariant stated verbatim in `parseStale`'s own doc comment (`sync.go:132`) —
  accumulates up to `replaceFileBatch` (256) writes and calls `replaceFilesTx` per batch, flushing a
  short final batch at the end.
- `SyncStats` accumulates in that writer as each batch is handed over, rather than in a second pass
  over a slice (`sync.go:86`).
- The first error from either side cancels the other and is returned, matching today's `firstErr`
  semantics (`sync.go:187`). A parse error must not leave the writer blocked on a channel that will
  never close, and a writer error must not leave parse workers blocked on a full channel — the
  cancellation has to run both directions.

Constraints that must not regress, each already load-bearing today:

- **Single writer.** SQLite admits one writer per database; more writer goroutines would only
  contend (§1.5's linear scaling shows serialization, not gain). One writer goroutine, not a pool.
- **Deletion pass ordering.** `Sync`'s delete-vanished-paths step (`sync.go:95`) and the
  `last_full_sync_at`/`touch` meta writes (`sync.go:111`) must still happen **after** every parse
  write has landed — they are the pass's commit point.
- **`ctx` cancellation.** `parseStale` returns `ctx.Err()` (`sync.go:203`); a cancelled Sync must
  still abort promptly with nothing half-committed beyond whole transactions.
- **Path-safety skips.** `parseOne`'s `ok == false` case (C13-8, `sync.go:252`) writes no row at all
  and is not an error; the channel path must keep dropping those silently.

Expected result on this repository, 4 CPUs: **3.51s → ~2.30s**, peak retained heap **153 MiB → a few
MiB**. §7 states how to verify both.

### 2.2 Why this is close to the floor, and why nothing further is proposed

With parse at 1.76s and write at 1.68s, a perfectly overlapped pipeline cannot beat
`max(1.76, 1.68) ≈ 1.8s` plus ramp-in/drain. The measured 2.30s is within ~28% of that bound, and
the remaining gap is the unavoidable serial head (the first batch cannot be written until 256 files
are parsed) and tail (the last batch cannot start until parsing ends).

Going below ~1.8s would require making the write phase itself faster, and §1.4 shows the only lever
of that size is dropping index maintenance during bulk load — declined on correctness grounds in
§6.5. Adding CPUs moves the parse side; nothing in this repository's code does.

So §2.1 is the whole throughput proposal. This plan deliberately stops there rather than stacking
speculative micro-optimizations onto an already-fast pipeline.

### 2.3 A bounded retry on `SQLITE_BUSY`

Framed honestly: this is **resilience insurance, not a measured speed win**. §1.5 shows the normal
path never hits BUSY. But when it does hit (a transaction stretched past 5s under extreme load), the
current behaviour is the worst available one — the whole Sync pass fails and every file already
parsed in memory is discarded.

In `apps/kira-studio/internal/codeindex/store.go`, wrap the per-batch `replaceFilesTx` call inside
`ReplaceFiles` (`store.go:123`) in a small bounded retry: on an error that is SQLite's BUSY/LOCKED
code, retry the **batch** a small fixed number of times with a short backoff, honouring `ctx`
cancellation between attempts; on any other error, return immediately as today. A whole batch is the
correct retry unit because `replaceFilesTx` is already all-or-nothing — it opens the transaction and
rolls back on any failure (`store.go:211`, `store.go:215`), so a retried batch cannot double-write.

Deliberately **not** included: raising `busy_timeout` above 5s (it would make a genuinely stuck
writer hang a Sync for longer rather than fail it), and any retry on the read paths (they were never
observed failing, and `ListFiles`/`GetFile` under WAL do not block behind a writer at all).

Detect the BUSY condition through the driver's own error code rather than by matching the string
`"database is locked"` — `modernc.org/sqlite` exposes the numeric code, and a string match would
silently stop working on a driver upgrade.

### 2.4 What the fix does not change

- **No schema change, no migration.** `migrations/0001_c1_init.sql` and `0002_…sql` are untouched;
  schema version stays 2. §6.3/§6.4/§6.5 decline every schema-shaped idea.
- **No `parser_fingerprint` change.** `Fingerprint()` (`fingerprint.go:41`) hashes grammar versions
  and query bytes plus `extractionVersion`. `codeparse` is not touched at all here, so no cache
  rebuild is forced by this phase's own landing.
- **No change to what is extracted.** Symbol and reference counts must be byte-identical before and
  after (§7 checks this explicitly). This is a scheduling change, not an extraction change.
- **No change to `syncWorkers()`, `replaceFileBatch`, or the DSN.** All three are already at or past
  their measured knee (§6.1, §6.2, §6.6).
- **No incremental/partial reindex path**, per the SPEC row (§6.8).

## 3. Work order

Each step ends in a commit. Fast gates (`go build`, `go vet`, the package's own tests) run per
commit; the expensive end-to-end verification runs once at step 5, per `CLAUDE.md`'s
"implement the whole plan first, then test once and fix what's found".

1. **Add the throughput benchmark first, against today's code** (`sync_bench_test.go`, §4.1). It
   must run and report a number on the *unmodified* pipeline — that number is the "before" half of
   §7's comparison, and writing the benchmark first is what keeps the comparison honest.
   Gate: `go test ./internal/codeindex/ -run xxx -bench BenchmarkFullSync -benchtime 1x` reports a
   time. Commit: `test(P64c): add full-Sync throughput benchmark`.

2. **Pipeline the writer** (§2.1) in `sync.go`. Restructure `parseStale` to stream `FileWrite`s and
   add the single writer goroutine; keep `Sync`'s deletion pass and meta writes after the drain.
   Gates: `go build ./...`, `go vet ./...`, `go test ./internal/codeindex/` all green;
   `go test -race ./internal/codeindex/` green (§4.2).
   Commit: `perf(P64c): overlap codeindex parse and write phases`.

3. **Add the concurrency tests** (§4.2, §4.3) — the race-detector Sync test and the error-propagation
   test. These guard the new goroutine structure and are the only new tests this plan asks for.
   Gate: `go test -race ./internal/codeindex/ -count=2` green (twice, to shake out flakes).
   Commit: `test(P64c): cover pipelined Sync under -race`.

4. **Add the bounded BUSY retry** (§2.3) in `store.go`, plus its test (§4.4).
   Gates: `go test -race ./internal/codeindex/` green.
   Commit: `fix(P64c): retry codeindex batch writes on SQLITE_BUSY`.

5. **Verify end-to-end** (§7): re-run the benchmark for the "after" number, confirm row counts are
   unchanged, confirm peak heap dropped, and run one real headless server against this repository to
   confirm a live reindex still answers correctly. Fix whatever this surfaces as follow-up commits.

6. **Update documentation** (§5) and log dogfooding findings (`docs/v1.6/mcp-repo-map-issues.md`).
   Commit: `docs(P64c): record measured index throughput and pipelined writer`.

Steps are strictly sequential — step 2 restructures the exact function steps 3 and 4 test. Nothing
here is parallelizable across subagents.

## 4. Tests

Judged against `CLAUDE.md`'s bar: *"Unit tests exist only for advanced, complex or deeply nested
logic."* A concurrency change is named in that rule's own list of things that **do** earn a test
("concurrency (ordering, backpressure, cancellation, races)"). §2.1 introduces a producer/consumer
pipeline with bidirectional error cancellation — squarely inside the bar. The tests below are scoped
to exactly that, and nothing else.

### 4.1 `BenchmarkFullSync` — the measurement, kept

A benchmark over a **generated** fixture repository (a few hundred small Go/TypeScript files written
into `t.TempDir()` and `git init`-ed), not this repository — a benchmark that depends on the
developer's own checkout is not reproducible and would drift with every commit. Reports ns/op for a
cold full `Sync`.

Earns its place not as a correctness test but as the standing answer to "did this get slower",
which is precisely the question this phase exists to answer and had no way to answer before.

### 4.2 Pipelined `Sync` under `-race`

One test that runs a full `Sync` over a fixture repository with enough files to cross the 256-file
batch boundary (so the writer flushes more than once while parsing continues) and asserts the
resulting rows are exactly correct: file count, symbol count and reference count identical to the
same fixture's expected values, with parent links intact.

Run under `go test -race`. This is the test that would catch the realistic failure mode of §2.1 — a
data race on the shared `SyncStats` map, or on the batch buffer between the writer goroutine and the
drain — which no amount of reading catches reliably. `ByLanguage` is a `map[codeparse.ID]int`
(`sync.go:43`) written per-write; moving that accumulation into the writer goroutine is exactly the
kind of change `-race` exists for.

### 4.3 Error propagation and cancellation

One test, two cases, on the pipeline's failure paths:

- **Parse-side error cancels the writer**, and `Sync` returns that error rather than hanging.
- **Cancelled context** mid-Sync returns promptly (bounded by a test timeout) with no goroutine left
  blocked — the deadlock this restructuring could plausibly introduce, and the one bug a reader
  cannot rule out by inspection.

Backpressure is covered implicitly: a bounded channel plus a fixture larger than the buffer means
the test in §4.2 exercises parse workers blocking on a full channel already.

### 4.4 BUSY retry

One test: hold the write lock past `busy_timeout` from a second connection (the §1.5 experiment,
kept as a test) and assert `ReplaceFiles` **succeeds** after the lock is released, where today it
fails. Concurrency with a real timing boundary, and the only proof the retry works at all.

Keep it robust rather than tight — assert the retry eventually succeeds, never assert an exact
attempt count or duration, so it does not flake on a loaded CI box (which is, after all, the exact
condition this phase studied).

### Deliberately no test for

- **`syncWorkers()`, `replaceFileBatch`, `buildDSN`.** Constants and a string builder. §6's numbers
  justify their values; a test would restate the function body.
- **The pragma read-back (§1.6).** A one-off diagnostic that answered its question. Asserting
  `journal_mode=wal` in perpetuity tests the driver, not this repository.
- **Per-statement write timings (§1.4).** Profiling output, not an invariant. Encoding 1.276s as a
  threshold would fail on any slower CI machine and assert nothing about correctness.
- **Anything re-checking extraction output.** `codeparse` is untouched; `extract_test.go` and the
  conformance suites already cover it.

## 5. Documentation to update

- **`docs/ARCHITECTURE.md`**, the `codeindex.db` storage paragraph (~line 855) and the C1 sync
  description: record that the reconcile pass **pipelines a single writer goroutine against the
  parse worker pool** rather than materializing every `FileWrite` first, and state the measured
  cold-index cost for this repository (1845 files → ~2.3s, 4 CPUs) so the next reader has a real
  baseline instead of folklore. Note the BUSY retry alongside the existing WAL/`busy_timeout`
  sentence.
- **`docs/ARCHITECTURE.md` "Known open items"**: add the one genuinely-still-open item this
  investigation found — the watcher is armed before the initial Sync completes
  (`repomap/server.go:168`–`170`), so watcher writes can interleave with it (§1.5, §6.7). It is
  real, currently true, and not fixed here. Do **not** add anything about parse speed: that is
  resolved, not open.
- **`docs/DEV_ENVIRONMENT.md`**, repo-map section: record that a **cold cgo rebuild of
  `kira-repo-map` is ~34s** on this container and is not index time — the single most useful fact
  for the next person who thinks a reindex is hanging, and the direct cause of this row's premise.
- **`docs/v1.6/mcp-repo-map-issues.md`**: log this phase's dogfooding per the log's own rules.
- **No `CLAUDE.md` change.** Nothing here is a new standing rule for how the team works.

## 6. Considered and declined

### 6.1 More parse workers — declined, with the table

`syncWorkers()` (`sync.go:27`) caps at 4. Raising the cap does nothing here: 4 / 8 / 16 workers
measure **1.632s / 1.593s / 1.632s** (§1.3). The box has 4 CPUs and `syncWorkers()` already returns
`NumCPU`; the cap is not even binding. The 8-worker figure is inside run-to-run noise, and 16 is
slightly worse.

The cap would bind on a larger machine — `min(NumCPU, 4)` on a 16-core box leaves parallelism unused.
But this phase's mandate is this repository's full parse, measured here, where the cap costs
**nothing**, and the comment at `sync.go:25` documents the cap as a deliberate politeness bound
("cap how much of the machine a background reindex takes, not maximise throughput"), matching
`gitclient.maxConcurrentReads`. Changing a deliberate resource-politeness decision on a box where it
demonstrably costs zero, to chase an unmeasured gain on hardware not in front of us, is exactly the
guess this row's "measure first" instruction forbids. Left alone.

### 6.2 Larger write transactions — declined, with the table

`replaceFileBatch` is 256 (`store.go:107`). Measured across the whole repository's writes:

| batch | elapsed |
|---|---|
| 1 | 3.223s |
| 16 | 1.937s |
| 64 | 1.772s |
| **256 (today)** | **1.627s** |
| 1024 | 1.614s |
| all 1846 in one transaction | 1.621s |

256 is past the knee. 1024 buys **0.8%** and a single giant transaction is *worse* than 1024 while
holding the write lock for the entire pass — which is precisely the >5s lock hold that produces
`SQLITE_BUSY` (§1.5). Raising it trades a rounding error of throughput for the one failure mode this
row asked about. Declined firmly.

Worth recording: batch=1 (3.223s vs 1.627s, **2.0x**) confirms the existing batching is doing real
work, and independently reproduces the 2.6x figure the C12-5 note cites for prepared statements.

### 6.3 Dropping `AUTOINCREMENT` from `reference`/`symbol` — declined, with the number

`AUTOINCREMENT` forces a `sqlite_sequence` row update per insert and is a well-known SQLite
throughput note, so it was measured rather than assumed: **1.432s with, 1.419s without** (§1.4,
variants A vs B) — **~1%**, inside noise. It buys a schema migration over every existing
`codeindex.db`, for nothing. Declined.

### 6.4 Disabling foreign keys during bulk load — declined, with the number

`_foreign_keys=1` means each `reference`/`symbol` insert validates `file_id` and `block_id` against
the parent tables. Plausible cost; measured at **zero**: 1.479s with FKs off versus 1.432s on
(§1.4, variants F vs A) — the "faster" configuration measured *slower*, i.e. pure noise. The
`ON DELETE CASCADE` behaviour that `DeleteFile`/`DeleteRepo` depend on (`store.go:313`,
`store.go:345`) is genuinely load-bearing. Declined: no gain, real risk.

### 6.5 Dropping indexes during bulk load and rebuilding after — declined, on correctness

The second-largest measured lever, so it gets a real answer rather than a dismissal. §1.4 variant E:
511ms insert + 423ms index build = **934ms against today's 1.432s, -35%** on the reference phase —
roughly **-0.5s** on a 3.45s full index.

Declined anyway, for a reason the number cannot override: `codeindex.db` is **one shared file across
every repository** (`docs/ARCHITECTURE.md` ~line 855; every table carries `repo_id`), and
`reference_name`/`symbol_name` are global indexes over *all* repositories' rows. Dropping them for
one repository's reindex would:

1. Degrade every concurrent query — including **C3's separate MCP server process**, which reads this
   exact file while the app writes it, and whose `find_references` depends on `reference_name`. A
   reindex would silently turn other repositories' lookups into full table scans.
2. Make the rebuild cost scale with *every* repository's rows, not the one being indexed. The 423ms
   above is for this repository alone; on a shared database it grows without bound.
3. Leave the database indexless if the process dies mid-load — a crash during reindex would
   permanently degrade an unrelated repository until something noticed.

A -0.5s gain does not justify making a shared, cross-process, cross-repository index transiently
absent. §2.1 recovers more than twice as much (-1.2s) with none of this exposure.

### 6.6 Rewriting `buildDSN` to `_pragma=` form — declined, disproved

Covered in §1.6: the hypothesis that `modernc.org/sqlite` ignores mattn-style DSN keys — which would
have meant no WAL, `synchronous=FULL` and no busy timeout — was the most promising lead in this
investigation and is **false**. Verified by reading the pragmas back off a live connection, and
confirmed in the driver source (`applyQueryParams`, `sqlite.go:285`), which implements the shorthand
keys deliberately and validates them "against the same set `github.com/mattn/go-sqlite3` accepts".
No change. Recorded so it is not re-raised.

### 6.7 Delaying the watcher until the initial Sync completes — declined, out of scope

`repomap/server.go:168`–`170` starts `runInitialSync` in a goroutine and arms `idx.Watch()`
immediately, so watcher writes can interleave with the initial full Sync (§1.5). Real, and worth
recording in "Known open items" (§5).

Not fixed here. It is not a throughput problem — §1.5 measures concurrent writers as producing zero
errors and merely serializing — and arming late would trade it for a genuine correctness gap: edits
landing during the initial Sync would be missed entirely, since nothing re-scans after the gate
opens. Doing it properly means queueing events during the initial Sync and draining after, which is
watcher-lifecycle design, not parse-and-write throughput. Wrong row.

### 6.8 An incremental / partial reindex path — declined by scope

Avoiding the full truncate-and-reparse when only a query file changed (a `parser_fingerprint`
mismatch reparsing everything, `sync.go:343`) is the most obvious way to make reindexing *feel*
faster, and is explicitly **out of scope** per the SPEC's own P64c row:

> How often a full reparse gets triggered (a query-file edit forcing a truncate-and-reparse instead
> of some narrower incremental path) is explicitly not this row's concern — that is a dev-only,
> low-frequency cost.

No partial or incremental reindex mechanism is designed or implemented in this phase. The row's
stated reasoning also holds up against §1's numbers: a real user's genuine first index of a new
repository has no prior state to reuse, so the full-parse path is the one that has to be fast, and
§2.1 makes exactly that path faster for everyone rather than special-casing the developer's
query-editing loop.

### 6.9 Multi-row `INSERT … VALUES (…),(…)` batching — declined, measurably worse

A standard SQLite bulk-load trick, and the obvious next idea once `insertRef` is identified as 80%
of the write phase (§1.4). Measured over the same 134,553 reference rows:

| rows per statement | elapsed |
|---|---|
| 1 (fresh `Exec`, unprepared) | 2.862s |
| 32 | 2.439s |
| 128 | 4.36s |
| 512 | 12.244s |

Every variant is worse than today's prepared single-row statement (1.432s), and it degrades sharply
with size: each distinct chunk width is a different SQL string, so the driver re-parses and re-plans
a progressively larger statement instead of reusing one prepared plan. The existing design — one
`tx.PrepareContext` per statement *shape*, reused for every row (`store.go:148`) — is already the
faster pattern by 1.7x against the best multi-row variant. Declined.

### 6.10 Reducing the number of reference rows — declined by scope

134,415 reference rows against 18,193 symbols is what makes the write phase what it is (§1.4).
Emitting fewer of them (dropping `call` references, or deduplicating by name per file) would cut
write time roughly proportionally.

It would also change what the index *contains*, and therefore what `find_references` can answer —
P64 and P64b both spent their effort widening exactly this coverage. A throughput row must not
quietly narrow a capability row's output. Declined: wrong trade, wrong phase.

### 6.11 `pprof` over wall-clock instrumentation — declined as unnecessary

The row permits "`go test`'s own benchmarking tools, `pprof`, or simple wall-clock instrumentation —
whichever is fastest to get a real answer". Phase-level wall-clock timing answered it immediately
and unambiguously: parse 1.76s / write 1.68s, and inside the write, `insertRef` 1.276s of 1.60s. The
bottleneck is a *phase-ordering* property, not a hot function, and a CPU profile would have pointed
at `modernc.org/sqlite`'s VM loop — true and useless. Per `CLAUDE.md`, "skip a measurement that
wouldn't change the decision."

## 7. Verification

**Before/after timing, this repository, stated as one comparison.** The benchmark from step 1
(§4.1) gives a reproducible fixture number; the headline number is the real repository:

| | before | after (expected) |
|---|---|---|
| full cold `Sync`, 1845 files | **3.51s** (mean of 3: 3.656 / 3.357 / 3.513) | **~2.30s** (measured on the prototype: 2.480 / 2.221 / 2.192) |
| peak retained heap during Sync | **153.1 MiB** | a few MiB (one 256-file batch in flight) |
| parse phase | 1.76s | unchanged (~1.76s, now overlapped) |
| write phase | 1.68s | unchanged (~1.68s, now overlapped) |

Accept the change if the full cold Sync lands at or under **2.8s** mean of three runs on an
otherwise-idle container (allowing headroom over the 2.30s prototype for the real implementation's
error plumbing). Reject and reconsider if it exceeds 3.0s — that would mean the overlap is not
actually happening.

**Correctness, which matters more than the timing.** After the change, over this repository:

- `file` = 1845, `symbol` = 18,187, `reference` = 134,218, `file_block` = 936 — **identical** to
  §1.1's pre-change counts. This is a scheduling change; any drift in these numbers is a bug.
- Parent links intact: the count of `symbol` rows with non-NULL `parent_id` stays at 1983.
- A second `Sync` immediately after parses **zero** files (the §5.3 staleness rule still holds), as
  `TestSync_UnchangedFileDoesNoWork` already asserts.

**Race freedom.** `go test -race ./internal/codeindex/ -count=2` green. Non-negotiable: this phase's
only substantive change is a new goroutine structure.

**Live server smoke check.** Build and run the headless server against this repository per
`CLAUDE.md`'s repo-map section, wait for the initial Sync, and confirm over plain HTTP/JSON-RPC that
a known symbol still resolves — e.g. `find_definition {"symbol":"ReplaceFiles"}` returns
`store.go`, and `search_symbols {"query":"parseStale"}` returns the `sync.go` function. Confirms the
pipelined writer produces a queryable index, not just correct row counts. Note the observed
wall-clock from process start to first successful query, and keep in mind (§1.2) that a cold rebuild
is ~34s of that and is not index time.

**Dogfooding.** Use the repo-map server for navigation throughout the implementation and log
findings in `docs/v1.6/mcp-repo-map-issues.md` per its own rules — trivial inline with a one-line
entry, non-trivial as a full entry left for a dedicated fix pass.
