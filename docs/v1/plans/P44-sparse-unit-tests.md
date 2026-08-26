# P44 — Sparse unit tests: five places where a unit test is genuinely the better instrument

> **The phase, in the user's own words** (SPEC.md:1064): *"add unit tests, but sparingly — only
> where there is enough logic to justify one, and only where a unit test is the better fit than the
> existing UI (Playwright) coverage when both could apply. `tests/db/` is explicitly out of scope"*,
> with the *why* column recording the framing directly: *"be scarce with new tests, prioritize unit
> over UI when both would work, never touch the DB suites."*
>
> **Three words do all the work in that sentence, and this plan treats each as a hard gate**, applied
> to every candidate before it earns a commit:
>
> 1. **"enough logic to justify one"** — real branching, not a getter, a two-line arithmetic helper
>    or a data table.
> 2. **"better fit than the existing UI coverage when both could apply"** — a candidate that a
>    Playwright spec *already drives, for real, in a run that actually happens* is rejected, not
>    duplicated. This gate alone kills the single most-recommended candidate P43 handed forward
>    (§1 F48).
> 3. **"`tests/db/` is explicitly out of scope"** — resolved as a numbered Decision (D49), because
>    P43 iteration 3 put two brand-new Docker-free unit specs *inside* that directory and then
>    recommended the same route to this phase by name.
>
> **Five commits. Sixteen candidates were read; eleven were rejected**, and every one of them is
> written up in §6 with the reason, at the same length as the accepted ones — this repo's own
> convention (iteration 3's §6, iteration 2's F27) and the only defence a scarce phase has against
> being re-opened by a later one that assumes the absence was an oversight.
>
> **Every route in this plan was proven by running it, not by reading.** Six throwaway spec files
> were written against the tree at `158fcba`, run with `bun test`, typechecked under a scratch copy
> of the `tests/unit/tsconfig.json` this plan proposes, and linted with `biome check` — **44 tests,
> 44 passing, `tsgo` exit 0, `biome check` clean** — then deleted. The measured results are quoted
> per candidate in §1 and per commit in §5. This is the same empirical discipline iteration 3 used
> before committing to its `bun:sqlite` harness, and it is why §4 promises runnable specs rather
> than hoping for them.
>
> **Branch tip when this plan was written: `158fcba` on `feature/kickoff`;
> `git status --porcelain` over the repo was empty apart from this file, and `bun run typecheck`
> (all four projects) was green.** Re-grep before editing.

---

## 0. Ground rules for this phase

- **Scarcity is the deliverable, not a constraint on it.** A phase told to be sparse fails by
  padding, not by being short. No candidate below earns a commit because it is *testable* — only
  because a unit test buys something the tree does not already have. Where the honest answer was
  "the existing coverage is fine", §6 says so and names the spec and line that already does the job.
- **Every claim carries a `file:line` read in the tree at `158fcba`.** Not one line number below was
  copied from P43 iteration 2's or iteration 3's plan; iteration 3's ten commits moved several of
  them, and each was re-opened. Where a claim is about *absence* (nothing tests X), it was produced
  by a repo-wide grep over `src/` **and** `tests/`, and the grep and its actual output are pasted.
- **No production code changes at all.** This is a test phase. Every commit in §4 touches
  `tests/unit/**`, plus — commit 1 only — `package.json`'s scripts and the root `tsconfig.json`'s
  `references`. If implementing a spec turns up a real defect, **do not fix it here**: write it up
  and hand it to §8, the way iteration 2 handed its own findings forward. A green new test that
  passes only because a fix rode along with it proves nothing about the fix.
- **`tests/db/` is not touched, in either direction** (D49). No file is added to it, no file is
  moved out of it, no file in it is edited — including the two Docker-free specs iteration 3 landed
  there. `git diff --name-only` for this whole phase must show **zero** paths under `tests/db/`.
  Likewise `tests/electron-db/` and `tests/ui/`: no existing spec is edited, deleted or renamed by
  this phase.
- **Every new spec must actually run, and pass, in this sandbox — no Docker, no Electron, no
  `node:sqlite`.** That is the entire point of the word "unit" here. A spec that needs a container
  is a `tests/db/` spec, and `tests/db/` is out of scope; a spec that needs a browser is a
  `tests/ui/` spec, and this phase adds none.
- **A stub is allowed to satisfy a module-scope global; it is never allowed to stand in for the code
  under test.** `globalThis.window` (commit 5) exists because `bridge/control.ts:33` reads
  `window.kira` at import time and `bridge/port.ts:29` registers a `window` listener — neither is
  read by anything this phase asserts. The same rule iteration 3's `tests/db/run-state.spec.ts`
  states in its own header comment.
- **P39's layering rules stand**, and `biome.json` is unchanged. Verified rather than assumed:
  `python3 -c "…json.load…"` over `biome.json` → `overrides: 7`, and **none of the seven `includes`
  matches `tests/**`** (`['**/*.vue']`, `['src/renderer/views/**']`, `['src/main/**', …]`,
  `['src/main/storage/**', …]`, `['src/engine/adapters/**']`, `['src/engine/adapters/s3/**', …]`,
  `['src/renderer/project/**']`). A scratch copy of all six candidate specs was run through
  `bunx biome check` in this sandbox: the only findings were formatting and import order, both fixed
  by `bun run format`, and **zero lint-rule violations** — so no `biome.json` change is needed and
  none is made.
- **No new dependency.** One new build-config surface, called out loudly and justified by D49: a
  `tests/unit/tsconfig.json` project, a `typecheck:unit` script folded into `bun run typecheck`, a
  `test:unit` script, and one line in the root `tsconfig.json`'s `references` — mirroring exactly how
  `tests/db/tsconfig.json` is already wired into `typecheck:db` and `test:db`.
- Comments per AGENTS.md: only where the code cannot say it for itself. In a spec file that means
  the *why this is a unit test and not a Playwright test* header each file carries (D50), and
  nothing else — never a comment restating what an `expect` already reads as.
- `bun run lint`, `bun run typecheck` (node, web, db, **unit** — five projects after commit 1, via
  `bun run typecheck`) and `bunx electron-vite build` stay green after **every** commit.
  Conventional Commits, one per step of §4.

---

## 1. Candidates

F-numbers continue from P43 iteration 3, which ended at **F41**. Decisions continue from **D48**.

### A. The scope contradiction, which has to be settled before anything else

**F42 — P43 iteration 3 created a Docker-free unit-test route *inside* the directory this phase is
told to stay out of, and then recommended it to this phase by name.** Both halves are real, and they
cannot both be honoured as written.

The instruction (SPEC.md:1064) is unambiguous about the directory:

> *"`tests/db/` is explicitly out of scope"* … *"never touch the DB suites"*

Iteration 3 is equally unambiguous about where it put its two new specs. `docs/v1/plans/P43-functionality-review-iter3.md:704-716`:

> *"**Two new Docker-free `bun:test` specs (D36/D37).** Both live beside `tests/db/preconnect.spec.ts`, the existing precedent for a `tests/db/` spec with no container"*
>
> ```
> tests/db/metadata-cache.spec.ts   # src/main/storage/repos/metadata-cache.ts over bun:sqlite
> tests/db/run-state.spec.ts        # src/renderer/state/runState.ts over a stubbed window
> ```

and its §8 items 6 and 7 (`:1078-1086`) hand this phase two more jobs *through that route*: the
redis/s3 catalog listings ("*now reachable through commit 1's harness pattern*") and the renderer
view-state modules ("*testable through commit 2's route*").

Both files exist and both are Docker-free — confirmed by running them here at `158fcba`:

```
$ bun test tests/db/metadata-cache.spec.ts tests/db/run-state.spec.ts
 (both pass; no daemon, no image pull, no node:sqlite)
```

So the directory `tests/db/` currently holds **three** distinct kinds of file:

| Kind | Files | Needs |
|---|---|---|
| Testcontainers adapter suites | `postgres`, `mysql`, `mariadb`, `mongo`, `redis`, `s3`, `sqs`, `rabbitmq`, `clickhouse` `.spec.ts` | Docker |
| A temp-file adapter suite | `sqlite.spec.ts` | `node:sqlite` (this Bun lacks it) |
| Docker-free unit specs | `preconnect.spec.ts` (P11), `metadata-cache.spec.ts`, `run-state.spec.ts` (P43 iter3) | nothing |

and one command over all of them:

```
$ grep -n '"test:db"' package.json
    "test:db": "bun test tests/db",
```

which **cannot go green in any box without Docker** — `sqlite.spec.ts` fails on the missing
`node:sqlite` (AGENTS.md's SQLite section) and every Testcontainers spec self-skips. Iteration 3's
own §5 conceded this in as many words (`:880-884`): *"`bun test tests/db` as a whole still does not
go green in this box … so commits 1–3 are verified by naming their files explicitly."*

That is the practical shape of the contradiction, and it is what D49 resolves. Note what is *not*
in dispute: nobody is proposing to expand, rewrite or re-run the Testcontainers suites. The question
is only where **new** unit specs go.

### B. Accepted candidates

**F43 — `shared/domain/sql-split.ts` is a hand-written lexer with six escape regimes, it decides
what SQL actually gets sent to a server, and nothing in `tests/` calls it.**

```
$ grep -rn "splitSqlStatements\|statementAtCursor" tests/
tests/db/fixtures/0010_clickhouse_seed.sql:…        (a comment in a .sql fixture)
tests/db/support/clickhouse.ts:…                    (the fixture loader's own private copy)
```

Neither is the module. `src/shared/domain/sql-split.ts` itself has **no test anywhere in the repo**,
and its two exports are read by exactly the two surfaces where a user's typed SQL becomes a run:
`views/console/ConsoleView.vue:123` (`statementAtCursor`, i.e. "Run statement") and `:129`
(`splitSqlStatements`, i.e. "Run all"), plus `workbench/panels/OperationsPanel.vue:100` for the
per-statement breakdown of a completed op.

The logic is not incidental. `splitSqlStatements` (`:14-84`) walks the source character by character
through six mutually exclusive regimes, each with its own escape rule:

- `--` to end-of-line (`:28-32`);
- `/* … */`, including the unterminated case where `i += 2` runs past the end (`:33-38`);
- `'`, `"` and `` ` `` runs, where the quote character **doubled** is an escape and a backslash
  escapes the next character — the file's own comment (`:39-42`) records that this is deliberately
  a superset of Postgres's and MariaDB's rules;
- Postgres dollar-quoting, `$$ … $$` or `$tag$ … $tag$`, matched by a regex against the tag and
  closed by `indexOf`, falling through to end-of-source when the tag never closes (`:63-73`);
- the `;` boundary itself, which pushes only a non-empty trimmed statement (`:20-23`, `:74-79`).

`SqlStatement`'s own doc comment (`:9-11`) states the invariant a caller depends on and no type can
enforce: *"Offsets into the original source, not `text` — `text` is trimmed, these are not."*
`statementAtCursor` (`:87-93`) is built entirely on it.

**Why a unit test rather than a Playwright one.** The failure mode is silent and destructive: a
semicolon inside a `$body$ … $body$` function definition splits one `CREATE FUNCTION` into two
fragments, and the server is then sent two syntactically broken statements. Reproducing that through
the console UI means typing a multi-line PL/pgSQL body into CodeMirror and reading what comes back —
in `tests/ui/console.spec.ts`, which is **Docker-gated** (`:18-19`, `isDockerAvailable()` →
`test.skip`) and therefore has never run in this sandbox at all. Each of the six regimes needs its
own input; six Playwright round trips against a live Postgres is minutes, and six `expect`s over a
pure function is milliseconds. This is the textbook case of "both could apply, and unit is the
better fit."

**Proven, not assumed.** A throwaway `tests/unit/sql-split.spec.ts` covering all six regimes plus
the offset invariant and `statementAtCursor` was written and run here:

```
$ bun test <scratch>/a-sql-split.spec.ts
 11 pass  0 fail  15 expect() calls   [24.00ms]
```

Every assertion passed on the first run — including the offset invariant
(`{ text: 'SELECT 1', start: 0, end: 12 }` for the source `'  SELECT 1  ;  SELECT 2'`), which was
guessed from the code and confirmed by execution. **The module is correct today; this commit is
about pinning it, not repairing it.**

**F44 — `engine/adapters/sql-text.ts` is the keyset-pagination brain for seven adapters, and its two
riskiest functions have no coverage that runs anywhere without a container.**

```
$ grep -rn "computeEffectiveOrder\|decodePageToken\|resolveProjection" tests/
(no output; exit 1)
```

Not one of them is named in any spec. Their reach, by contrast, is the widest of anything in this
plan — `grep -rn "from '../sql-text'" src/engine/adapters` reaches **seven** adapters:
`postgres/read.ts:15-19`, `mysql-family/read.ts:15-19`, `sqlite/read.ts:15-19`,
`clickhouse/read.ts:11`, `redis/read.ts:9`, `kafka/read.ts:7` and `mongo/read.ts:10`.

Two functions carry the logic:

- **`computeEffectiveOrder` (`:165-215`)** decides whether keyset pagination is legal at all, and it
  says no in three structurally different ways: a `text` sort is never eligible (`:170-172`); a
  requested sort with **mixed** directions is not eligible, because a row-value comparison
  `(a, b) > (p, q)` has one operator for the whole tuple (`:184-194`); and an absent tiebreaker
  disqualifies it while still keeping the direction for the plain `LIMIT/OFFSET` path (`:197-204`).
  When it *is* eligible, it appends the tiebreaker columns in the requested direction, **skipping
  any the user already sorted by** (`:206-208`) — a duplicate `ORDER BY` term would make the keyset
  predicate's parameter list and its column list disagree in length.
- **`decodePageToken` (`:65-83`)** is the security-shaped half: it refuses a malformed base64/JSON
  payload, refuses a payload that does not match `PageTokenPayload`'s shape (`:53-62`), and — the
  one that matters — refuses a well-formed token whose **fingerprint** no longer matches, with a
  message naming exactly why (`:75-81`). A fingerprint check that silently passed would hand a
  keyset boundary built for one filter/sort/projection to a query using another, and the user would
  get a page of rows from the wrong place with no error at all.

**Why a unit test rather than the existing coverage.** There is existing coverage — inside
`tests/db/postgres.spec.ts`, `mysql.spec.ts`, `mariadb.spec.ts`, `sqlite.spec.ts` and
`clickhouse.spec.ts`, every one of which is Testcontainers-backed or `node:sqlite`-backed and
**none of which has ever run in this sandbox** (AGENTS.md's Docker section; image pulls return 403).
Worse, that coverage is *incidental*: those suites page through real tables and assert rows, so they
exercise the eligible-and-correct path and never the three refusal paths. Driving "mixed sort
directions must disqualify keyset" through a live Postgres means constructing the sort in the UI or
the request and then inferring the strategy from `position.strategy` — an inference, three layers
away from the branch. Six `expect`s over the pure function is the direct statement of the same fact.

**Proven, not assumed.** A throwaway spec over both functions plus `buildKeysetPredicate`,
`resolveProjection`, `safeInt` and `stripOneTrailingSemicolon` was written and run here:

```
$ bun test <scratch>/d-sql-text.spec.ts
 13 pass  0 fail  25 expect() calls   [82.00ms]
```

All 13 passed. `node:crypto`'s `createHash` (`:1`, used by `requestFingerprint`) and `Buffer`
(`:50`, `:68`) both resolve under `bun test` with no shim.

**F45 — `views/shared/page/scan.ts`'s `runChunkedScan` has been the subject of three separate P43
findings and still has no deterministic assertion anywhere.** Handed forward twice: iteration 2's §8
item 10, iteration 3's §8 item 5 (*"which F36, F36a and F40 all touch and none of which any
DOM-level assertion in this repo can reach deterministically"*). Re-verified against the current
file rather than taken on trust.

`runChunkedScan` (`:63-118`) is a two-phase frame-driven scheduler with four behaviours worth
pinning, all of them defined *by frame boundary*:

1. **Chunking.** `CHUNK_ROWS = 2000` (`:19`); each `step()` scans a chunk, calls `onProgress` once
   (`:86`), and either schedules the next frame (`:87`) or resolves (`:88`).
2. **The priority window** (P42 D37). When `opts.priority` is given and non-empty after clamping
   (`:93-96`), it runs in **its own frame first** (`:97-106`), publishes with `rowsScanned === 0` and
   with its *own* match array — never folded into `matches` (`:102-104`) — and only then starts the
   ordinary ascending pass. The file's own comment (`:56-62`) states the contract this exists to
   preserve: *"the final array is strictly ascending regardless of where the priority window sat."*
3. **Clamping.** `Math.max(0, priority.from)` / `Math.min(totalRows, priority.to)` (`:94-95`), with
   `to > from` as the guard that an empty or inverted window falls through to the plain path
   (`:96`, `:107-109`).
4. **Cancel.** Checked at the top of `step()` (`:78-81`) *and* at the top of the priority frame
   (`:98-101`), and both resolve `done` with whatever `matches` holds — the partial-result contract
   iteration 2's D33 depends on (`SearchToolbar.vue:72` names it).

Plus `eachMatch` (`:38-50`), whose zero-width-match guard (`:47`) is the difference between a
`x*`-style pattern finishing and hanging the renderer forever.

**Why a unit test rather than a Playwright one — and this is the sharpest case in the plan.** Every
one of those four behaviours is a statement about *which animation frame something happens on*. A
Playwright test cannot pause between frames; it can only wait for a settled end state, by which time
the priority tick, the chunk boundaries and the cancel point have all been erased. Iteration 3's own
§5 admitted this twice about a related surface — its commit 6 row (`:910`) says the SQLite seed
*"is three rows and completes in one frame, so there is no in-flight scan to navigate"*, and its
commit-4 row (`:908`) says the stale-failure half *"has no DOM assertion the suite can make
deterministically"*. A fake `requestAnimationFrame` that hands frames out one at a time turns all
four into ordinary assertions. This is not "both could apply" — only one instrument can reach it.

**Proven, not assumed.** A throwaway spec with a queue-based fake `requestAnimationFrame`
(`frames.push(cb)`, a `runFrame()` that shifts and calls one) was written and run here:

```
$ bun test <scratch>/b-scan.spec.ts
 8 pass  0 fail  15 expect() calls   [52.00ms]
```

It asserted, and all passed: nothing is published before the first frame; a 5 000-row page publishes
`rowsScanned` exactly `[2000, 4000, 5000]`; a priority window of `{ from: 4000, to: 4500 }` publishes
`rowsScanned === 0` with only its own five matches on the very first frame and the final array still
starts at row 0; a `{ from: -50, to: 150 }` window clamps to rows 0 and 100; cancel before the first
frame resolves `[]`; cancel after one frame resolves the 20 matches found so far; an invalid regex
throws **synchronously**, before any frame (`compilePattern` at `:70`, outside the Promise's frame
scheduling); and `eachMatch(/x*/g, 'abc')` emits `[0, 1, 2, 3]` and terminates. **`scan.ts` imports
nothing at all** — no `window` stub is needed, only the global `requestAnimationFrame` the module
calls by name.

**F46 — `redis/catalog.ts`'s `listNamespaceChildren` and `s3/catalog.ts`'s `listPrefixChildren` own
the `truncated` flag P43 iteration 2 added, and the only way anything has ever exercised it is by
having more keys than a round budget can reach.** Handed forward twice (iteration 2's §8 item 9,
iteration 3's §8 item 6). Both cited functions re-read at `158fcba` and both still shaped as
described.

The flag's definition is a two-term conjunction in each file, and getting either term wrong is
invisible in normal use:

```ts
// redis/catalog.ts:111
  const truncated = cursor !== '0' && rounds >= MAX_SCAN_ROUNDS;
// s3/catalog.ts:138
  const truncated = !!continuationToken && rounds >= MAX_LIST_ROUNDS;
```

Drop the second term and every multi-round listing claims truncation; drop the first and a scan that
happens to exhaust exactly at the cap claims it too. `MAX_SCAN_ROUNDS = 200` (`redis/catalog.ts:11`)
and `MAX_LIST_ROUNDS = 20` (`s3/catalog.ts:15`) are what make the honest version expensive to reach:
a live assertion needs a namespace big enough to survive 200 SCAN rounds at `COUNT 1000`, which is
iteration 2's own *"without seeding 200 000 keys"*.

Around the flag sits real per-round logic worth the same pass. Redis: the prefix is rebuilt from the
descent's local segments and never from a leaf (`:57`); a key is a **namespace** or a **key**
depending on the first `:` *after* the prefix (`:73-75`); a namespace already seen is skipped
(`:89`) while keys are keyed by the full key (`:76`); and the two groups are sorted and concatenated
namespaces-first (`:104-107`). S3: `CommonPrefixes` become **local** segments via
`cp.Prefix.slice(prefix.length, -1)` (`:104`) while `Contents` keep the **full** key, for the reason
its own 8-line comment gives (`:116-122`); and the exact-prefix "directory marker" object is skipped
(`:113`). Both check `ctx.signal.aborted` at the top of every round and throw `E_CANCELLED`
(`redis:64`, `s3:81`).

**Why a unit test rather than the existing coverage.** `tests/db/redis.spec.ts` and
`tests/db/s3.spec.ts` both exercise these functions against a live server — and both are
Testcontainers-backed, so neither has ever run in this sandbox, and neither drives truncation
(seeding 200 000 keys per test run is not a thing either suite does or should do). The functions
take a *client object* as their first parameter, which is the seam: a fake with a `scan` or a `send`
method that returns canned pages drives all 200 rounds in under a millisecond and lets a test assert
the exact `MATCH` argument and round count.

**Proven, not assumed.** A throwaway spec with a fake `Redis` (a `scan` that returns a scripted
`[cursor, keys]`) and a fake `S3Client` (a `send` that returns a scripted page and records
`cmd.input`) was written and run here:

```
$ bun test <scratch>/c-catalog.spec.ts
 9 pass  0 fail  19 expect() calls   [258.00ms]
```

All nine passed, including both cap assertions —
`expect(calls.length).toBe(200)` for redis and `expect(inputs.length).toBe(20)` for s3, each with
`truncated === true` — and both negative cases, where a cursor that *does* return to `'0'` inside the
cap leaves `truncated` **`undefined`** (the functions return `{ nodes }` without the key at all,
`redis:112` / `s3:139`, which the specs assert as `toBeUndefined()` rather than `toBe(false)`).

**F47 — the two ordering bugs P43 iteration 3 fixed in the renderer's view-state modules are pinned
today only by Docker-gated Playwright steps that cannot deterministically produce the race they
test.** Handed forward as iteration 3's §8 item 7, which called it *"the highest-value thing P44
could build."* Both fixes re-read at `158fcba`; both are present and correct. The question this
phase has to answer is not whether they work, but whether their **current** coverage is adequate.
It is not, and for a different reason in each case.

- **`views/browse/state.ts`'s supersession guard (iteration 3 D39/F35).** The mechanism is
  `loadSeq`: `:75` mints `const seq = ++rt.loadSeq;` before the await, and `:82` and `:87` re-check
  it on the success and the failure path. Its coverage is iteration 3's commit 4:
  `tests/ui/redis.spec.ts` and `tests/ui/s3.spec.ts` each gained a *"descend into a namespace and
  immediately press Up"* step. Both are Docker-gated — and even on a box with containers, that step
  only exercises the guard **if the slow load happens to still be in flight when Up lands**. If the
  level is small or the container is fast, the step passes without the guard existing at all. It is
  a test that cannot fail for the right reason on demand. Iteration 3's own §5 said as much about
  the other half of the same commit (`:908`): *"has no DOM assertion the suite can make
  deterministically."*
- **`views/keyvalue/state.ts`'s cursor-strategy reload (iteration 3 D40/F37).** The mechanism is
  `:79-85`: when `getPage(tabId)?.position.strategy !== 'offset'`, a bare `load()` sends
  `{ mode: 'offset', offset: 0 }` **and** calls `patchKeyValueTabState(tabId, { pageIndex: 0 })`;
  otherwise it sends `pageIndex * pageSize`. Its coverage is two Docker-gated pieces — a
  `tests/db/redis.spec.ts` assertion that the *adapter* serves page one for an offset cursor on a
  hash, and a `tests/ui/redis.spec.ts` page-forward-then-Refresh step. Neither pins the **renderer's
  branch**: the first is about the adapter, and the second observes a rendered outcome that a dozen
  other things also produce. The interesting assertion — *"the second `data.read` call for a
  cursor-paged tab carries `offset: 0`, and the tab's own `pageIndex` came back to 0 with it"* — is
  a statement about a request payload and a piece of session state, which is a unit-test shape.

Both modules are plain TypeScript over `bridge/data` / `bridge/control`, which are `window.kira`
wrappers, so the route is iteration 3's own D37 stub widened by one line.

**Proven, not assumed.** Two throwaway specs were written and run here. The browse one gates
`control.treeChildren` on a manually-resolved promise so the **older** load is made to land
**after** the newer one — the exact interleaving no Playwright test can force:

```
$ bun test <scratch>/e-browse-state.spec.ts   →  1 pass  0 fail
$ bun test <scratch>/f-keyvalue-state.spec.ts →  2 pass  0 fail
```

The keyvalue spec asserts both branches: a `cursor`-strategy page reloads with
`{ mode: 'offset', offset: 0 }` and `findKeyValueTab(id)?.state.pageIndex === 0`, while an
`offset`-strategy page on the same code path still reloads with `{ mode: 'offset', offset: 200 }`
and leaves `pageIndex` at 2 — the negative guard that D40 narrowed nothing.

**One thing the scratch run established that a reading would have got wrong.** The `{ kira: {} }`
stub iteration 3 used for `runState` is **not** sufficient here, because `state/tabs.ts` calls
`control.onFlushBeforeClose(...)` at module scope (`state/tabs.ts:130`, through
`bridge/control.ts:64`) and the import fails outright:

```
TypeError: kira.onFlushBeforeClose is not a function.
      at src/renderer/bridge/control.ts:64:62
      at src/renderer/state/tabs.ts:130:9
```

The fix, confirmed working, is a single auto-vivifying proxy that answers every `window.kira.*`
lookup with a no-op subscriber — D53 records it and why it is a global stub rather than a mock of
anything under test.

### C. Verified non-findings — candidates read and rejected

These are the rejections that most need their reasons written down, because each was either
recommended to this phase by name or is the obvious thing a later reader would ask about. The full
rejection list, including the ones from the independent sweep, is §6.

**F48 — `celleditor/generate.ts`'s `encodeUlidTime`/`toCrockford` do not need a unit test, and
iteration 2's own caveat about them is true.** Handed to this phase twice (iteration 2's §8 item 7,
iteration 3's §8 item 5, the latter already conceding *"this is about speed rather than coverage"*).
Verified rather than assumed, and the answer is **no**, on two independent grounds:

1. **Neither function is exported.** `src/renderer/views/shared/celleditor/generate.ts:19`
   (`function toCrockford`) and `:39` (`function encodeUlidTime`) are module-private; only
   `GENERATORS` (`:77`) leaves the file. A unit test would have to either export them for the test's
   benefit — widening a module's public surface to be tested is the tail wagging the dog — or go
   through `GENERATORS`, decoding a real ULID's timestamp half and comparing it to `Date.now()`.
2. **Going through `GENERATORS` is character-for-character what `tests/ui/sqlite.spec.ts:320-331`
   already does**, and — decisively — **that spec is not Docker-gated and runs unconditionally in
   this sandbox on every Playwright run** (`grep -n "isDockerAvailable\|test.skip"
   tests/ui/sqlite.spec.ts` → no output; AGENTS.md's SQLite section: *"the one DB-backed UI spec
   that actually executes in Claude Code's own Linux web container"*). The assertion there is the
   real one:

   ```ts
   let decodedMs = 0;
   for (const c of ulid.slice(0, 10)) decodedMs = decodedMs * 32 + CROCKFORD.indexOf(c);
   expect(Math.abs(decodedMs - Date.now())).toBeLessThan(5 * 60 * 1000);
   ```

   That is exactly the assertion F22's bug failed by a factor of four, made against a ULID generated
   by the real button in the real app, in a run that actually happens.

This is gate 2 from the header, applied literally: both instruments could apply, and the one already
in the tree is *executing*. Adding a second is duplication, and duplication is what a sparse phase
is told not to do. **Recorded at this length so a fourth phase does not re-open it — this is the
third time it has been raised.**

**F49 — `beautify.ts`, `celleditor/detect.ts` and `celleditor/timestamp.ts` are the strongest
rejected candidates, and the reason they are rejected is scope discipline, not a shortage of
logic.** All three were read in full. Each genuinely clears gate 1, and each is worth naming so the
rejection reads as a decision rather than an oversight:

- **`src/renderer/beautify.ts`** (513 lines) is two hand-written parsers — a JSON recursive-descent
  cursor (`:30-176`) and an XML tokenizer plus tree builder (`:282-442`) — behind four exports
  (`scanJson:177`, `beautifyJson:241`, `scanXml:455`, `beautifyXml:502`), each with an indent and a
  compact renderer.
- **`src/renderer/views/shared/celleditor/detect.ts`** (375 lines) has a documented rule no
  Playwright spec drives: `ELIGIBLE_BY_TYPE_CLASS` (`:23-30`) is a gate applied *before* any
  detector runs, and its own comment (`:19-22`) states the consequence — *"an int4 column holding
  `12345678` must come back `text`, never `hex`"*. `detectFormat` (`:336-350`) then sorts by score
  and breaks ties on `PRECEDENCE` (`:36-47`).
- **`src/renderer/views/shared/celleditor/timestamp.ts`** (292 lines) is epoch/ISO/local/UTC
  conversion with a fractional-digits parameter — arithmetic that is classically wrong at
  boundaries.

They are rejected because of what happens *when* they are wrong, which is the discriminator this
phase's scarcity mandate needs. A wrong `detectFormat` guess or a wrong `beautifyXml` indent is
**visible and recoverable in one click** — the format picker (P42 D27/P43 D43) sits right beside the
value, the user overrides it, and `tests/ui/cell-editor.spec.ts` drives that whole surface. A wrong
`splitSqlStatements` (F43) or a wrong `decodePageToken` fingerprint check (F44) is **silent**: the
user gets executed SQL they did not write, or a page of rows from the wrong place, with nothing on
screen saying so. Two rounds of P43's functionality review passed over all three of these files and
found nothing; F22 by contrast *was* a real bug in this exact family, and it is already pinned
(F48). And pinning `beautify.ts` "sparingly" is self-contradictory — five token assertions over two
parsers buy little, and the forty it would actually take is the padding this phase is told not to
write. **Recorded as the strongest candidates a later phase should reach for first if it ever wants
a sixth unit spec.**

---

## 2. Shapes introduced in this plan

**A new `tests/unit/` directory (D49), with the same three-part wiring `tests/db/` already has.**

`tests/unit/tsconfig.json` — mirrors `tests/db/tsconfig.json` exactly, with two deliberate
differences noted inline:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun-types"],
    "paths": {
      "@shared/*": ["../../src/shared/*"]
    }
  },
  "include": ["**/*.ts", "../../src/renderer/env.d.ts"]
}
```

- `"lib"` gains `DOM`/`DOM.Iterable`, which `tests/db/tsconfig.json` does not carry: `scan.spec.ts`
  names `requestAnimationFrame` directly, which `bun-types` alone does not declare. This is the same
  `lib` line `tsconfig.web.json` already uses for the renderer itself.
- `"include"`'s `"../../src/renderer/env.d.ts"` is the one iteration 3 added to `tests/db/`
  (its D37) for the same reason — it is what makes `window.kira` resolve.

`package.json` — three lines, mirroring `typecheck:db` / `test:db`:

```json
    "typecheck": "bun run typecheck:node && bun run typecheck:web && bun run typecheck:db && bun run typecheck:unit",
    "typecheck:unit": "tsgo --noEmit -p tests/unit/tsconfig.json",
    "test:unit": "bun test tests/unit",
```

`tsconfig.json` (root) — one line in `references`, beside the three already there:

```json
    { "path": "./tests/unit/tsconfig.json" }
```

**The `window` stub, in the two specs that need one (D53).** Four lines at the top of the file,
before any dynamic import:

```ts
// bridge/control.ts:33 reads `window.kira` at module scope and bridge/port.ts:29 registers a
// `window` listener; state/tabs.ts:130 then *calls* control.onFlushBeforeClose at module scope, so
// an empty `{ kira: {} }` throws on import. Every `window.kira.*` here answers with a no-op
// subscriber — nothing this file asserts reads any of them.
(globalThis as { window?: unknown }).window = {
  kira: new Proxy({}, { get: () => () => () => {} }),
  addEventListener: () => {},
};
```

**The fake `requestAnimationFrame`, in `scan.spec.ts` only (D52).** A queue plus two drivers, so a
test can advance exactly one frame or drain them all:

```ts
const frames: (() => void)[] = [];
globalThis.requestAnimationFrame = (cb) => frames.push(cb);
function runFrame(): boolean { const cb = frames.shift(); if (!cb) return false; cb(); return true; }
async function drain(): Promise<void> { /* runFrame + await Promise.resolve(), bounded */ }
```

**Five spec files, and no other new file anywhere:**

```
tests/unit/tsconfig.json
tests/unit/sql-split.spec.ts     # shared/domain/sql-split.ts
tests/unit/sql-text.spec.ts      # engine/adapters/sql-text.ts
tests/unit/scan.spec.ts          # renderer/views/shared/page/scan.ts
tests/unit/catalog-listing.spec.ts  # engine/adapters/{redis,s3}/catalog.ts
tests/unit/view-state.spec.ts    # renderer/views/{browse,keyvalue}/state.ts
```

---

## 3. Decisions

D-numbers continue from P43 iteration 3, which ended at **D48**.

### The scope decision

| # | Decision | Rationale |
|---|----------|-----------|
| D49 | **`tests/db/` is out of scope in the whole-directory sense, in both directions: this phase adds no file to it, moves no file out of it, and edits no file in it. New unit specs live in a new `tests/unit/` directory**, wired with its own `tsconfig.json`, a `typecheck:unit` script folded into `bun run typecheck`, a `test:unit` script, and one entry in the root `tsconfig.json`'s `references` — mirroring `tests/db/`'s own wiring exactly. The two Docker-free specs P43 iteration 3 landed in `tests/db/` (`metadata-cache.spec.ts`, `run-state.spec.ts`) **stay exactly where they are, untouched.** | F42, and this is the decision the phase turns on, so the reasoning is written out rather than asserted. **Three readings were weighed.** *(a) "out of scope" means the Testcontainers suites specifically, so P44 may keep adding to `tests/db/`.* Rejected: it requires reading a directory path as a synecdoche for a subset of that directory's files, and it produces the outcome the instruction most obviously forbids — a phase told `tests/db/` is out of scope adding five files to `tests/db/`. The instruction names a **path**, not a technology. *(b) The whole directory is off-limits, so new specs need a new home — but the two iteration-3 files should be moved into it for consistency.* Rejected on the second clause only: a `git mv` out of `tests/db/` is work **in** `tests/db/`, which is precisely what "out of scope" forbids in this repo's own vocabulary (every plan's §6 means "this phase does no work there"), and it would falsify committed prose — SPEC.md's P43 row and iteration 3's plan both cite those two paths by name. Moving files that already have executed, passing coverage buys tidiness and risks the instruction. *(c) — adopted.* The whole directory is off-limits, new specs go to `tests/unit/`, and the two iteration-3 files stay put. **This is also the only reading that is safe under the other two**: it satisfies (a) trivially and (b) in the part that matters, whereas (a) violates (b) outright. **And it is better on the merits independent of the ambiguity.** `bun run test:db` is `bun test tests/db`, which **cannot go green in a box without Docker** — `sqlite.spec.ts` needs `node:sqlite` and every Testcontainers spec self-skips (iteration 3's §5 conceded this and worked around it by naming files individually). Putting unit specs there permanently buries a green signal under a red suite and makes "run the unit tests" a per-file incantation. `bun run test:unit` over `tests/unit/` goes green in **any** box, with no daemon, no image, no Electron and no `node:sqlite` — which is the whole point of the word "unit" in this phase's name. The cost is one honest wart: two Docker-free specs live in `tests/db/` and five live in `tests/unit/`. §8 hands the reconciliation to **P45 (docs/structure cleanup)**, whose own remit already includes reconsidering the repo's folder structure — the right phase for a move, and one that is not forbidden from touching `tests/db/`. |
| D50 | **Every spec file opens with a short header comment stating *why this is a unit test and not a Playwright test*** — naming the specific existing spec (and its Docker gate, where it has one) that would otherwise be the instrument. No other comments unless the code cannot say it for itself. | The header is the one thing the code genuinely cannot say. Nine months from now the reasonable question about any of these files is *"we have a Playwright suite; why is this here?"*, and the answer — "the branch is a frame boundary", "the Playwright spec is Docker-gated and cannot force the interleaving", "seeding 200 000 keys" — is a fact about the *other* file, invisible from this one. Both iteration-3 specs already do exactly this (`tests/db/run-state.spec.ts:3-10`, `metadata-cache.spec.ts:9-18`) and both are better for it. Rejected: a single shared README under `tests/unit/` — a reason that lives one file away from the spec it justifies is a reason nobody reads. |
| D51 | **This phase changes no production code.** A defect surfaced while writing a spec is written up and handed to §8, not fixed here — and the spec is written to pass against the tree as it stands, never as an aspiration. | The user asked for tests. A phase that quietly ships fixes under `test:` commits makes both halves unreviewable: the fix has no plan entry and the test proves nothing about it (a test written in the same commit as the fix it "verifies" cannot fail against the pre-fix tree, because that tree is gone). It also keeps every commit here trivially revertible. If §4's implementation finds something real, that is a genuine result — §8 is where it goes, exactly as iteration 2 handed its own four candidates forward. |

### The five specs

| # | Decision | Rationale |
|---|----------|-----------|
| D52 | **`scan.spec.ts` drives `runChunkedScan` through a queue-based fake `requestAnimationFrame`** installed on `globalThis` at module scope, with a `runFrame()` that executes exactly one frame and a bounded `drain()` that runs to completion. Assertions cover: nothing published before the first frame; the `[2000, 4000, 5000]` chunk boundary sequence; the priority tick's `rowsScanned === 0` and its own separate match array; the final array still ascending from row 0; window clamping at both ends; cancel before the first frame and cancel mid-scan; the synchronous `SyntaxError` for an invalid regex; and `eachMatch`'s zero-width guard. | F45. A queue rather than a timer-based fake because every behaviour here is defined *by frame boundary*, and a queue is the only fake that lets a test stand between two frames — which is exactly where the priority tick, the chunk boundary and the cancel point live. `runChunkedScan` calls `requestAnimationFrame` by name at call time, so a `globalThis` assignment is enough and no module-loading trick is needed: `scan.ts` imports **nothing**, so unlike every other spec here it needs no `window` stub at all. Verified by running it (§1 F45): 8 pass. Rejected: `bun:test`'s `setSystemTime`/timer mocks — the module never touches a clock, only the frame callback, so a clock fake would control nothing. Rejected: asserting through one of the six real call sites (`views/{grid,documents,keyvalue,console}/search.ts`) — each adds a page store and a row-decode path between the test and the scheduler, and the scheduler is what is under test. |
| D53 | **`view-state.spec.ts` covers `views/browse/state.ts`'s supersession guard and `views/keyvalue/state.ts`'s cursor-strategy reload fallback in one file**, over a `globalThis.window` stub whose `kira` is an auto-vivifying `Proxy` returning a no-op subscriber for every property, installed before dynamic `import()`s of `state/tabs`, `bridge/control`, `bridge/data` and the two view modules. Each test opens its own tab with `{ newTab: true }` and stubs `control.treeChildren` / `data.read` by property assignment on the exported object. | F47. One file, not two: the two modules share the entire harness (the stub, the tab opener, the bridge patch) and differ only in which exported function is called — splitting them would duplicate thirty lines of setup to separate two tests. The `Proxy` rather than iteration 3's literal `{ kira: {} }` is not a refinement, it is a requirement, and it was found by **running** it, not reading: `state/tabs.ts:130` calls `control.onFlushBeforeClose(...)` at module scope and the import throws without it (the traceback is quoted in §1 F47). Property assignment on `control`/`data` rather than a module mock because both are plain exported object literals (`bridge/control.ts:43`, `bridge/data.ts:38`) — assigning a property needs no runtime mocking facility and leaves the module graph honest. `{ newTab: true }` on every opener because `openTab`'s reuse branch (`state/tabs.ts:202-210`) would otherwise hand a second test the first test's tab, and Bun runs a directory's spec files in one process. The browse test resolves the **older** load's promise **after** the newer one's — the interleaving a Playwright test cannot force, and the entire reason this file exists. Verified by running it (§1 F47): 1 + 2 pass. |
| D54 | **`catalog-listing.spec.ts` covers both `redis/catalog.ts`'s `listNamespaceChildren` and `s3/catalog.ts`'s `listPrefixChildren` in one file**, each driven by a hand-written fake client (a `scan` returning scripted `[cursor, keys]` tuples; a `send` returning scripted `ListObjectsV2` pages and recording `cmd.input`) and a real `AbortController`'s signal as `OpCtx`. Both round caps are asserted by call count (200 / 20) alongside `truncated === true`, and the complete-listing cases assert `truncated` is **`undefined`**, not `false`. | F46. One file because the two functions are deliberate mirrors of each other — `s3/catalog.ts:12-14`'s own comment says it *"mirrors redis/catalog.ts's own SCAN_COUNT/MAX_SCAN_ROUNDS"* — and reading their two truncation conjunctions side by side is the point. A hand-written fake rather than a mocking library because each client is reached through exactly one method and no dependency may be added. `toBeUndefined()` rather than `toBe(false)` because that is what the code actually returns (`redis:112`, `s3:139` return `{ nodes }` with no key at all when not truncated) and a spec that asserts a friendlier shape than the wire carries is a spec that will not notice when the wire changes. A real `AbortController` rather than a stub signal so the `E_CANCELLED` path (`redis:64`, `s3:81`) is exercised through the same object the engine passes. Verified by running it (§1 F46): 9 pass. |
| D55 | **`sql-split.spec.ts` asserts all six lexical regimes, the unterminated variants of the two that can run off the end, the empty-statement drop, the `start`/`end`-index-the-original-source invariant, and `statementAtCursor`'s containment and past-the-end fallback.** | F43. The six regimes are the whole function; testing three of them would pin the easy half and leave dollar-quoting — the regime whose failure silently corrupts a `CREATE FUNCTION` body — as the untested one. The offset invariant gets its own assertion because it is stated in a doc comment (`sql-split.ts:9-11`), is not expressible in the type, and is the sole contract `statementAtCursor` is built on. Verified by running it (§1 F43): 11 pass, every assertion correct on the first run. |
| D56 | **`sql-text.spec.ts` covers `computeEffectiveOrder`'s three disqualification paths plus its tiebreaker-append-and-dedup, and `decodePageToken`'s three refusals plus the round trip**, with `buildKeysetPredicate`'s four operator combinations, `resolveProjection`'s ordinal-order/dedup/unknown-column behaviour, `safeInt` and `stripOneTrailingSemicolon` alongside. | F44. The three disqualification paths are the point: the five Testcontainers suites that reach this file page real tables and therefore only ever walk the eligible-and-correct path. `buildKeysetPredicate` is included because it is four lines with a genuinely non-obvious operator rule (`:36`, `(mode === 'after') === (direction === 'asc')`) and it is the other half of the same feature — a correct eligibility decision feeding a flipped comparison is a silent wrong-page bug. `resolveProjection`'s ordinal-order sort (`:104`) is included for the reason its own comment gives: three adapters' normalisation depends on it. Verified by running it (§1 F44): 13 pass. |

---

## 4. Implementation order

Five commits. Each is one sitting, independently reviewable and independently revertible, touches
**only** `tests/unit/**` (plus commit 1's two build-config files), leaves `lint` / `typecheck` (node,
web, db, **unit**) / `bunx electron-vite build` green, and — the point of the phase — **runs and
passes for real in this sandbox.** No commit depends on another except that **1 must land first**
(every later commit needs the project and the scripts it creates).

Ordering is by descending independence: the two zero-dependency pure-module specs first, then the
one that needs a global fake, then the two that need stubbed collaborators.

1. **`test(unit): a tests/unit project, and the SQL statement splitter is pinned`** — D49/D50/D55/F42/F43.
   New `tests/unit/tsconfig.json`; new `tests/unit/sql-split.spec.ts`; `package.json` gains
   `typecheck:unit` and `test:unit` and appends `typecheck:unit` to the `typecheck` chain; the root
   `tsconfig.json` gains one `references` entry. **No `src/` change and no `tests/db/` change.**
   Scenarios, in `tests/db/preconnect.spec.ts`'s numbered style: (1) a `;` inside a single-quoted
   literal is not a boundary; (2) a doubled `''` escape; (3) a backslash escape; (4) `--` to
   end-of-line; (5) `/* … */`, including an unterminated one; (6) `$body$ … $body$` around a body
   containing two semicolons, and an unterminated `$$` swallowing the rest; (7) backtick- and
   double-quoted identifiers; (8) empty statements dropped (`';;  ;\n'` → `[]`); (9) `start`/`end`
   index the *original* source while `text` is trimmed; (10) `statementAtCursor` inside each
   statement, past the end, and over an empty source (`null`). **Runs for real in this sandbox** —
   `bun run test:unit`.
2. **`test(unit): keyset eligibility and page-token refusals are pinned`** — D56/F44.
   New `tests/unit/sql-text.spec.ts` only. Scenarios: (1) a `text` sort is never keyset-eligible;
   (2) mixed sort directions disqualify keyset while keeping both terms; (3) an absent tiebreaker
   disqualifies keyset but keeps the direction; (4) the tiebreaker is appended in the requested
   direction and a column already sorted by is never duplicated; (5) no sort at all is ascending and
   eligible on the tiebreaker alone; (6) an unknown sort column throws `E_NOT_FOUND`; (7) a token
   round-trips under a matching fingerprint; (8) a **mismatched fingerprint is refused**, with the
   message naming why; (9) a malformed token and a wrong-`v` payload are both refused;
   (10) `buildKeysetPredicate`'s four `direction` × `mode` combinations; (11) `resolveProjection`
   returns ordinal order, dedups a repeated request, returns the input array identically for `null`,
   and throws for an unknown column; (12) `safeInt` refuses negative and non-integer; (13)
   `stripOneTrailingSemicolon` strips exactly one, with its trailing whitespace. **Runs for real.**
3. **`test(unit): the chunked search scanner's frame semantics are pinned`** — D52/F45.
   New `tests/unit/scan.spec.ts` only. Scenarios: (1) nothing is published before the first frame;
   (2) a 5 000-row page publishes `rowsScanned` exactly `[2000, 4000, 5000]` and resolves ascending;
   (3) a priority window runs in its own first frame, publishing `rowsScanned === 0` and **only its
   own** matches; (4) the final array is still strictly ascending from row 0 after a priority pass;
   (5) a window is clamped at both ends (`{ from: -50, to: 150 }`); (6) an empty or inverted window
   falls through to the plain path with no priority tick; (7) cancel before the first frame resolves
   `[]`; (8) cancel mid-scan resolves with what was found so far; (9) an invalid regex throws
   **synchronously**, before any frame; (10) `eachMatch` terminates on a zero-width pattern and
   resets a shared `RegExp`'s `lastIndex`. **Runs for real.**
4. **`test(unit): the redis and s3 listings' truncation flag is pinned without a container`** —
   D54/F46. New `tests/unit/catalog-listing.spec.ts` only. Redis scenarios: (1) the namespace/key
   split falls on the first `:` after the prefix, and the result is namespaces-then-keys, each
   sorted; (2) a nested level scans the joined prefix (`'a:*'`) and dedups a repeated segment;
   (3) a cursor that never returns to `'0'` runs exactly `MAX_SCAN_ROUNDS` rounds and reports
   `truncated: true`; (4) a scan that completes inside the cap reports `truncated` **`undefined`**;
   (5) an already-aborted signal throws `E_CANCELLED` before the first `scan` call. S3 scenarios:
   (6) `CommonPrefixes` become local segments while `Contents` keep the full key, and `Prefix`/
   `Delimiter` are sent as expected; (7) the exact-prefix directory marker is skipped;
   (8) a continuation token that never clears runs exactly `MAX_LIST_ROUNDS` rounds and reports
   `truncated: true`; (9) a listing that completes inside the cap reports `truncated` `undefined`.
   **Runs for real.**
5. **`test(unit): a superseded browse load and a cursor-paged reload are pinned deterministically`** —
   D53/F47. New `tests/unit/view-state.spec.ts` only. Scenarios: (1) with two `treeChildren` calls
   held open, resolving the **newer** first and the **older** second leaves `runtime[id].nodes`
   holding the newer level's nodes — the guard iteration 3 D39 added, exercised in the interleaving
   no Playwright test can force; (2) a superseded *failure* does not redden a level that loaded
   fine (the same guard's `catch` path, `views/browse/state.ts:87`); (3) `rt.truncated` is reset to
   `false` when a load starts (D39's second half, `:79`); (4) a `cursor`-strategy key/value page
   reloads with `{ mode: 'offset', offset: 0 }` **and** returns `pageIndex` to 0; (5) an
   `offset`-strategy page on the same path still reloads with `pageIndex * pageSize` and leaves
   `pageIndex` alone — the negative guard that D40 narrowed nothing. **Runs for real.**

**Docs are deliberately not a commit here.** SPEC.md:1064's P44 row still reads *"Not yet planned —
queued"*; it is written **once, after commit 5 lands**, as a separate `docs(spec): record P44's
sparse unit tests` commit outside this plan's implementation order — see §8. **This plan file is the
only doc this phase's numbered commits touch.**

---

## 5. Verification

**Say plainly what this box can and cannot do — and then say the good news.** Per AGENTS.md:
`bun run lint`, `bun run typecheck` and `bunx electron-vite build` all run here (`bun run typecheck`
was run against the tree at `158fcba` while writing this plan — exit 0, all four projects). Docker
image pulls return 403, so every Testcontainers spec self-skips; `tests/electron-db/kafka.spec.ts`
additionally needs a native rebuild that cannot fetch Electron's headers here; this box's Bun lacks
`node:sqlite`.

**None of that matters to this phase.** **All five commits run and pass here, for real.** This is
the first phase in the sequence with **no** verification debt of its own — a direct consequence of
gate 3 in the header (a spec that needs a container is not a unit spec) and of D49 (a directory whose
suite command actually goes green).

The invocation, after commit 1:

```
bun run test:unit          # === bun test tests/unit
bun run typecheck          # node, web, db, unit — five tsgo/vue-tsc projects after commit 1
bun run lint
bunx electron-vite build
```

**Measured while writing this plan, on throwaway copies of all five specs** (deleted afterwards;
`git status --porcelain` was empty before this file was written):

```
$ bun test <scratch>/
 44 pass  0 fail  79 expect() calls   Ran 44 tests across 6 files. [421.00ms]

$ bunx tsgo --noEmit -p <scratch>/tsconfig.json
 (exit 0)

$ bunx biome check <scratch>
 Checked 7 files in 12ms. No fixes applied.   (after `biome check --write`; only formatting and
 import order were ever reported — zero lint-rule findings)
```

| Spec | Runs in this sandbox? |
|---|---|
| `tests/unit/sql-split.spec.ts` (new, commit 1) | **Yes, for real** — a pure `@shared` module, zero imports beyond types. Confirmed: 11 pass. |
| `tests/unit/sql-text.spec.ts` (new, commit 2) | **Yes, for real** — `node:crypto` and `Buffer` both resolve under `bun test`. Confirmed: 13 pass. |
| `tests/unit/scan.spec.ts` (new, commit 3) | **Yes, for real** — a `globalThis.requestAnimationFrame` queue; the module under test imports nothing. Confirmed: 8 pass. |
| `tests/unit/catalog-listing.spec.ts` (new, commit 4) | **Yes, for real** — hand-written fake clients; `@aws-sdk/client-s3`'s `ListObjectsV2Command` constructor resolves fine under `bun test`. Confirmed: 9 pass. |
| `tests/unit/view-state.spec.ts` (new, commit 5) | **Yes, for real** — the `Proxy` `window.kira` stub plus dynamic imports. Confirmed: 1 + 2 pass. |
| `tests/db/*`, `tests/electron-db/*`, `tests/ui/*` | **Untouched by this phase** — not re-run as part of it beyond the standing regression check below. |

| Commit | What must be re-run green | What it pins |
|---|---|---|
| 1 | `lint` + `typecheck` (**all five projects** — this is the commit that adds the fifth, and `node`/`web`/`db` must each stay green, i.e. the new project must not pull `tests/unit/**` into any existing `include`) + `bun run test:unit` **here, for real** | That a `;` inside a string, an identifier, a comment or a `$tag$` body is not a statement boundary, and that `SqlStatement.start`/`.end` index the original source. The `end: 12` assertion on `'  SELECT 1  ;  SELECT 2'` is the exact fact `statementAtCursor` — and therefore "Run statement" — is built on. Also that `bun run test:unit` **goes green as a whole command**, which `bun run test:db` cannot (D49's practical half). |
| 2 | `typecheck` (unit) + `bun run test:unit` **here, for real** | That keyset pagination is refused in all three ways it must be, and that a page token minted under one filter/sort/projection is refused under another. Scenario 5 (no sort at all → eligible on the tiebreaker alone) is the negative guard that the disqualification paths did not swallow the ordinary case seven adapters depend on. |
| 3 | `bun run test:unit` **here, for real** | That the priority window publishes in its own frame with its own array and never contaminates the ascending result — P42 D37's contract, which F30, F36, F36a and F40 all reason about and none of which any spec in the repo asserts. The two cancel scenarios pin iteration 2's D33 partial-result contract. Scenario 9 pins that a bad regex fails *before* a frame is scheduled, so a toolbar's `try` around the call actually catches it. |
| 4 | `bun run test:unit` **here, for real** | That `truncated` is the two-term conjunction it is written as: set when the round cap cuts a still-open cursor short, **absent** when the listing completed inside the cap. Scenarios 4 and 9 are the guards that a future change to either loop cannot start reporting truncation for every multi-round listing. `tests/db/redis.spec.ts` and `tests/db/s3.spec.ts`, re-run elsewhere on a box with Docker, remain the guards that the *real* clients still drive these functions the way the fakes do. |
| 5 | `bun run test:unit` **here, for real** | That iteration 3's D39 and D40 do what their comments claim, in the exact interleaving that makes them necessary. Scenarios 1 and 2 force the older-lands-after-newer ordering by construction; scenario 5 is the guard that D40's cursor-strategy branch left a list key's offset paging byte-identical. The Docker-gated `tests/ui/redis.spec.ts` / `tests/ui/s3.spec.ts` steps iteration 3 added stay as they are and remain the end-to-end half. |

**Standing regression check, after every commit** (not a per-commit assertion about behavior — this
phase changes none — but the guard that the new project and the new scripts disturbed nothing):

```
bunx electron-vite build && xvfb-run -a bunx playwright test \
  tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts tests/ui/smoke.spec.ts \
  tests/ui/connections.spec.ts tests/ui/workbench.spec.ts
```

plus `bun test tests/db/preconnect.spec.ts tests/db/metadata-cache.spec.ts
tests/db/run-state.spec.ts` — the three Docker-free specs in the directory D49 leaves alone, re-run
purely to prove this phase did not disturb them.

**Manual click-through: none.** There is nothing to click. This phase changes no production code
(D51), so there is no user-visible behavior to inspect — the first time in this sequence that is
true, and it is stated rather than left as a suspicious absence.

---

## 6. Explicitly out of scope

P43 iterations 1, 2 and 3's own §6 lists are **not** re-opened. New to this phase — every candidate
read and rejected, with the reason, because a scarce phase's rejections are its main product:

**Rejected from the handed-forward list:**

- **`celleditor/generate.ts`'s `encodeUlidTime` / `toCrockford`** — F48, at length. Neither is
  exported, and the only test that could exist is character-for-character
  `tests/ui/sqlite.spec.ts:320-331`, which is **not Docker-gated** and executes on every Playwright
  run in this sandbox. Gate 2, applied literally. Third time raised; recorded so it is the last.

**Rejected from the independent sweep**, in descending order of how close each came:

- **`src/renderer/beautify.ts`** (513 lines; `scanJson:177`, `beautifyJson:241`, `scanXml:455`,
  `beautifyXml:502`) — F49. The strongest rejected candidate on logic alone: two hand-written
  parsers with indent and compact renderers each. Rejected because a wrong result is visible and
  one-click-recoverable next to the value, `tests/ui/cell-editor.spec.ts` and `tests/ui/s3.spec.ts`
  both drive it, two rounds of functionality review found nothing in it, and pinning two parsers
  "sparingly" is a contradiction — five assertions buy little and forty is padding. **Reach for this
  one first if a later phase wants a sixth unit spec.**
- **`celleditor/detect.ts`'s `detectFormat`** (`:336-350`, with `ELIGIBLE_BY_TYPE_CLASS:23-30` and
  `PRECEDENCE:36-47`) — F49. Real logic, and its eligibility rule (*"an int4 column holding
  `12345678` must come back `text`, never `hex`"*, `:19-22`) is genuinely undriven by any spec.
  Rejected on the same visible-and-recoverable ground: the format picker sits beside the value and
  the user overrides a wrong guess in one click.
- **`celleditor/timestamp.ts`** (`parseTimestamp:124`, `encodeTimestamp:145`, `toEditableText:253`,
  `fromEditableText:274`) — F49. Local/UTC and fractional-digit arithmetic, classically wrong at
  boundaries. Same rejection: `tests/ui/cell-editor.spec.ts` drives `TimestampPane.vue` end to end,
  and a wrong reading is displayed, not silently committed.
- **`views/grid/pendingChanges.ts`'s `buildPlan`** (`:184-200`). Genuinely substantial — it turns
  staged edits, staged nulls, duplicated rows, toggled deletes and insert rows into an ordered
  `MutationRowOp[]`. Rejected on two grounds: it is **not exported** (only `previewPending` `:202` and
  `commitPending` `:212` are, and both reach it through `bridge/data`), and — more importantly —
  `tests/ui/mutations.spec.ts` asserts the *rows that end up in the database*, which is a strictly
  stronger claim than any assertion about the plan's shape. A unit test here would be a weaker test
  of the same thing.
- **`shared/protocol/page.ts`'s `assertPageStructure` and `createTabularPageBuilder`** (618 lines,
  mostly zod schemas). Rejected: every `tests/db/*` suite and every read in the app run through
  `assertPageStructure` on the response path, so it is the single most-exercised function in the
  repo. Adding a direct test adds nothing.
- **`renderer/project/filterTree.ts`'s `toggleKind` / `toggleNode`** (`:188`, `:198`). Set algebra
  over `TreeVisibility`, moderate logic. Rejected: it reads `state/connections` for the connection
  kind (`:39-41`), so the harness cost approaches commit 5's, while `tests/ui/tree.spec.ts` drives
  the whole filter surface for real and the failure mode (a row visible that should not be) is
  immediately obvious on screen.
- **`views/shared/document/rows.ts`'s `rowHeight`** (`:207-222`). Named as load-bearing by
  iteration 3's D42, which is why it was read. Rejected: it is
  `HEAD_H + lines * LINE_H + BODY_PADDING_V` — arithmetic with no branch, and iteration 3's own
  commit 7 already guards it structurally (`git diff --stat` on the file must be empty) and
  observably (a rendered-height assertion in `tests/ui/mongo.spec.ts`). Gate 1: not enough logic.
- **`views/console/lint.ts`** (`:8`, `lintSqlConsole`). Rejected as largely redundant after commit 1:
  its SQL half is a thin pass over `splitSqlStatements`, and its Mongo half delegates to
  `views/shared/document/ejson.ts`'s `tryParseShellText`, which `tests/ui/autocomplete.spec.ts`
  drives.
- **`views/shared/document/ejson.ts`** (608 lines) and **`engine/adapters/mongo/literal.ts`**
  (338 lines). Both real parsers with no direct test (`grep -rn "tryParseShellText" tests/` → no
  output). Rejected on scarcity alone, and this is the honest word for it: they clear gate 1 and
  arguably gate 2, and they lost to the five above on blast radius — a Mongo shell-literal
  misparse surfaces as a lint squiggle or a refused statement, not as executed-but-wrong work.
  **The second place a later phase should look.**
- **`views/shared/page/sizes.ts`** (`pageSizeOptions`, 6 lines after iteration 3's D46) and
  **`renderer/wheelScroll.ts`** / **`views/shared/page/visibleRows.ts`**. Gate 1: a filter over a
  four-entry constant, a wheel-delta swap, and a per-tab window setter. Not enough logic.
- **`views/shared/typeGlossary.ts`** (290 lines) and **`celleditor/formats.ts`**. Data tables with a
  lookup, not algorithms.

**Rejected as approaches, not as candidates:**

- **Moving `tests/db/metadata-cache.spec.ts` and `tests/db/run-state.spec.ts` into `tests/unit/`.**
  D49 rejects it with reasons: it is work inside a directory this phase is told to stay out of, and
  it falsifies committed prose in SPEC.md's P43 row and iteration 3's own plan. §8 hands the
  reconciliation to P45.
- **Adding a test-runner or assertion dependency** (`vitest`, `@vue/test-utils`, `sinon`,
  `msw`, …). `bun:test` covers every scenario in §4 — proven by running all of them — and §0
  forbids a new dependency. Where a fake was needed it was five lines of hand-written object.
- **Mounting a Vue component in a unit test.** Every accepted candidate is a plain module; nothing
  here renders. Component-level testing is a different tool with a different dependency and a
  different phase's decision behind it, and this phase does not open it.
- **Extracting a seam from `kafka/read.ts` so iteration 2's commit 3 becomes unit-testable.**
  Iteration 3's §6 already rejected exactly this as the speculative refactor its §0 forbids; D51's
  no-production-change rule forbids it again here, from the other direction. It remains §8's
  outstanding item, owned by whoever next runs CI or the macOS/Colima box.
- **A `tests/unit/README.md`.** D50 rejects it: the reason a spec exists belongs in that spec's own
  header, not one directory away.

---

## 7. Acceptance checklist

- [ ] `git diff --name-only` for this whole phase shows **zero** paths under `tests/db/`,
      `tests/electron-db/`, `tests/ui/` or `src/` — the whole phase touches only `tests/unit/**`,
      `package.json`, `tsconfig.json` and this plan file (D49/D51).
- [ ] `bun run test:unit` is green **in this sandbox**, as a whole command, with no Docker daemon,
      no Electron binary and no `node:sqlite` — five spec files, all passing.
- [ ] `bun run typecheck` runs **five** projects (node, web, db ×2 via `typecheck:db`, unit) and is
      green; `grep -n '"typecheck"' package.json` shows `typecheck:unit` in the chain, and
      `grep -n "tests/unit" tsconfig.json` shows the `references` entry.
- [ ] `tests/unit/tsconfig.json` carries `"lib": ["ESNext", "DOM", "DOM.Iterable"]` and
      `"../../src/renderer/env.d.ts"` in its `include`; `tests/db/tsconfig.json` is **byte-identical
      to its state at `158fcba`**.
- [ ] `bun test tests/db/preconnect.spec.ts tests/db/metadata-cache.spec.ts
      tests/db/run-state.spec.ts` still passes — the three Docker-free specs D49 deliberately leaves
      in place.
- [ ] Every one of the five spec files opens with a header comment naming *why a unit test and not a
      Playwright test*, and identifying the existing spec (and its Docker gate, where it has one)
      that would otherwise be the instrument (D50).
- [ ] `tests/unit/scan.spec.ts` asserts a `rowsScanned` sequence of exactly `[2000, 4000, 5000]`, a
      priority tick at `rowsScanned === 0` carrying **only** the window's own matches, and a final
      array beginning at row 0.
- [ ] `tests/unit/catalog-listing.spec.ts` asserts `truncated` is **`undefined`** — never `false` —
      for a listing that completes inside the round cap, and asserts the cap by call count
      (200 for redis, 20 for s3).
- [ ] `tests/unit/view-state.spec.ts` resolves the **older** `treeChildren` promise **after** the
      newer one and still reads the newer level's nodes; and asserts a list-key reload is unchanged
      alongside the cursor-key one.
- [ ] `grep -rn "vitest\|@vue/test-utils\|sinon\|jest" package.json tests/unit` returns nothing; the
      dependency lists in `package.json` are byte-identical to their state at `158fcba`.
- [ ] `bun run lint`, `bun run typecheck` and `bunx electron-vite build` clean after **every**
      commit; the Docker-free Playwright subset
      (`sqlite`/`startup`/`smoke`/`connections`/`workbench`) still green **in this sandbox** after
      every commit.
- [ ] **No `data-testid` was added, removed or renamed anywhere** — this phase adds no production
      code and therefore no test hooks.

---

## 8. What is left, and who owns it

**SPEC.md is written once, after commit 5 — not during it, and not by any commit in §4.**
SPEC.md:1064's P44 row still reads *"Not yet planned — queued"*. That edit is a separate
`docs(spec): record P44's sparse unit tests` commit at the very end of this phase's implementation,
and it must cover:

1. **The §10 P44 row itself** — five commits, what each pins, and the honest headline that this is
   the first phase in the sequence whose entire deliverable runs for real in the planning /
   implementation sandbox.
2. **The `tests/db/` scope decision (D49) stated in the row**, because it is a repository convention
   from now on and not a detail of one phase: unit specs go in `tests/unit/`, `tests/db/` holds the
   DB suites, and `bun run test:unit` is the command that goes green anywhere.
3. **The eleven rejections, in one sentence** — that P44 read sixteen candidates and accepted five,
   with §6 as the record, so a later phase reads the absence as a decision.

**Handed forward:**

4. **The split between `tests/db/`'s three Docker-free specs and `tests/unit/`'s five — owner:
   P45 (docs cleanup).** D49 deliberately leaves `tests/db/preconnect.spec.ts`,
   `metadata-cache.spec.ts` and `run-state.spec.ts` where they are, because moving them is work
   inside a directory this phase was told to stay out of. P45's own remit (SPEC.md:1065) already
   includes reconsidering the repo's folder structure, it is not under this phase's prohibition, and
   moving three files plus updating two prose citations is a ten-minute job there. **Recorded so the
   split reads as a decision with an owner rather than an oversight.**
5. **`src/renderer/beautify.ts` is the strongest candidate P44 rejected**, and
   `views/shared/document/ejson.ts` / `engine/adapters/mongo/literal.ts` are second. F49 and §6 give
   the reasons; none of them is "it can't be tested". If a later phase wants unit coverage beyond
   this one's five, that is the order to take them in — and `tests/unit/` will already exist.
6. **Anything commit 1–5's implementation turns up is a finding, not a fix (D51).** If writing a
   spec exposes a real defect in the module it covers, it is written up here — and the spec is
   still written to pass against the tree as it stands, so the defect stays visible rather than
   being silently absorbed.

**Not this phase's, and still open from P43:**

7. **Iteration 2's commit 3 (`62a85b3`, the Kafka EOF/high-watermark clamp) has still never been
   executed anywhere.** Iteration 3's §8 item 4 owns it; nothing in this phase changes that.
   `tests/electron-db/kafka.spec.ts` needs Docker **and** an `electron-rebuild` that can fetch
   Electron's C++ headers, and this sandbox has neither. Iteration 3 re-read the diff adversarially
   and found it correct, and §6 above re-rejects the "extract a testable seam" workaround for the
   same reason iteration 3 did. **Owner: whoever next runs CI or the macOS/Colima box.**
