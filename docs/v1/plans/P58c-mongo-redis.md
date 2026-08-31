# P58c — MongoDB and Redis, native (M7, ending at checkpoint C1c)

> **Parent:** `docs/v1/plans/P58-go-native-adapters.md`. That document's §0.3 splits P58 into six
> sub-phases and assigns **P58c** the single milestone **M7 — MongoDB and Redis**: *"Carries D11
> (`literal.go` and its unit test, written first). Ends with `tests/db/{mongo,redis}.spec.ts`
> deleted and their Go successors green."* Its sub-phase table's own justification for grouping the
> two: *"the two adapters that produce a page shape the SQL family never does (`DocumentPage`,
> `KeyValuePage`) and that each carry their own hand-written expression language (`mongo/literal.ts`,
> 338 lines; `redis/console.ts`). Grouped because 'a new page builder plus an original parser' is the
> same problem twice."* §1.1 checks that justification against the tree and finds it half right in
> both halves — which changes this plan's shape, not its scope.
>
> **Predecessors:** `docs/v1/plans/P58a-substrate-postgres.md` (M0–M5, complete; §12/§13 record real
> results) and `docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` (M6.0–M6.4, complete; §12/§13 the
> same). Five of eleven kinds are Go-native at `223cf02`: `postgres`, `mariadb`, `mysql`, `sqlite`,
> `clickhouse`. **P58c writes no substrate**, and — unlike P58b — it barely uses the SQL half of the
> one that exists (§1.3). What it does need is four small lifts, two of which exist *only* because
> P58a and P58b deliberately parked their own placeholders on the two kinds this sub-phase makes
> native (§1.8, §1.9).
>
> **What this document may not relitigate.** The parent's Decisions (P58 D1–D20), its research (§1),
> its target tree (§3), its designs (§4), its testing plan (§5) and its sequencing (§9) are settled,
> as are P58a's A1–A21 and P58b's B1–B24 for everything already built. Where this plan deviates from
> a parent *design* it says so in the open with the reason; where the tree contradicts a predecessor
> plan's own closeout claim, §1 records the tree (§1.10 does exactly that, twice).
>
> **Decision numbering, and the one collision to be careful about.** P58c's own decisions are
> **C1–C25**. The parent's coexistence checkpoints are also spelled with a C (**C1**, **C1b**, and
> this plan's new **C1c**) — so throughout this document *a checkpoint is always written with the
> word "checkpoint" immediately before it* (**checkpoint C1c**) and *a decision never is* (**C7**).
> A parent decision is always written **P58 D\<n\>** in full, a P58a decision **P58a A\<n\>**, a
> P58b decision **P58b B\<n\>** — never bare.
>
> Every claim below was read out of the tree as it stands at `223cf02` (P58b M6.4's own commit) with
> `git grep`, `wc -l` and the actual files. Every Go driver claim is marked **researched** (checked
> against the module proxy's own version list, or against the driver's public API surface) or **must
> be proven in M7.0**. Deliberately, **this plan downloaded no Go module** — `shell/go.mod` gains
> nothing until M7.3 — so no claim below is sourced from a module cache read the way P58b §1.4–§1.6
> were. Where that matters, §6's probes are written to settle it against a running server rather
> than an argument.

## 0. What this sub-phase is, and what it is not

### 0.1 The five bodies of work

1. **M7.0 — probes.** Throwaway Go programs, no product code, settling the four things this plan's
   decisions rest on that only a running server (or a running driver) can confirm: whether
   `bson.MarshalExtJSON` matches the `bson` npm package's `EJSON.stringify(…, {relaxed: false})`
   **byte for byte, for every BSON type the fixture actually contains** (MG-1); whether
   `$currentOp` + `killOp` work from the fixture's *unprivileged* `kira` user and what the killed
   operation's own error looks like (MG-2); go-redis's SCAN-family iteration including redis's own
   HSCAN reordering, its default RESP protocol version, and what a context-cancelled command does to
   the pooled connection (RD-1); and `testcontainers-go`'s `mongodb`/`redis` modules starting in
   **this** sandbox (TC-3). §6.
2. **M7.1 — the shared lifts.** Four changes to already-existing code that all of M7.2–M7.4 depend
   on and that are far cheaper before the adapters than after: moving
   `adapterhost.TestKindNodeServed` off `"mongodb"` (§1.8, C14); moving
   `tests/e2e-real/mariadb-real.spec.ts`'s Node-served side off MongoDB (§1.9, C15); normalizing
   `Router.childrenNative`'s nil `Nodes` slice (§1.3 gap 4, C16); and giving
   `internal/adapters/testsupport/spec.go` the `DocumentPage`/`KeyValuePage` readers it has only a
   `TabularPage` one of today (§1.3 gap 3). **`nativeKinds` does not change in M7.1**, so the whole
   existing suite must stay green through it.
3. **M7.2 — `mongo/literal.go` and its unit test, alone.** P58 D11's own milestone-within-a-milestone:
   *"the single largest piece of genuinely original logic in the eleven adapters … it gets a real Go
   unit test with the same cases the existing tokenizer's behaviour implies, written before the
   port."* No adapter, no driver, no container — `literal.go` imports nothing but `internal/adapters`
   and the BSON codec. It is the one file in P58c that can be written and proven with no Docker at
   all, and doing it first means M7.3 starts with its hardest problem already solved.
4. **M7.3 — MongoDB.** One `mongo` package, `go.mongodb.org/mongo-driver/v2`. `nativeKinds` gains
   `mongodb`.
5. **M7.4 — Redis, and checkpoint C1c.** One `redis` package, `github.com/redis/go-redis/v9`.
   `nativeKinds` gains `redis`, reaching **seven of eleven**. Then **checkpoint C1c** (§7): P58b's
   own checkpoint C1b re-run against a coexistence pairing that still exists after this sub-phase —
   because the one C1b used does not (§1.9).

### 0.2 Not in this sub-phase

- **No substrate change beyond M7.1's four lifts.** `internal/page`, `internal/enginecache`,
  `internal/enginebackend` and `internal/adapterhost`'s scheduler/dispatcher/session halves are
  untouched. §1.3 is the evidence: every hook these two adapters need already exists, including both
  page builders they were said to require (§1.1).
- **No `src/` change at all.** Not one file, not one line — the same strong form P58b B21 asserted
  and met. `git diff --stat src/` returns empty at every milestone boundary (C22).
- **No `tests/ui/` change and no `tests/ipc/` change.** P58a A10 still holds. `tests/ipc/redis/`'s
  backend half keeps driving the TypeScript redis adapter and keeps passing; §1.11 records what that
  costs and why bringing P58 D13's generator port forward for one adapter would be worse.
- **No deletion of `src/engine/`.** Both TypeScript adapters stay exactly where they are; P58f
  deletes them.
- **`shell/go.mod` gains exactly two runtime modules** (`go.mongodb.org/mongo-driver/v2`,
  `github.com/redis/go-redis/v9`) plus two test-only `testcontainers-go` modules. No BSON library
  other than the driver's own `bson` package; no JSON5/expression-evaluator library at all (P58 D11).
- **No re-measurement.** `docs/PERF.md`'s chunk-encoding measurement was P58a M2's and is done.

### 0.3 The one thing in P58c that is hard to walk back, and why it is worse here than in P58b

Everything M7.2–M7.4 adds is additive Go: two new packages, one new parser, two new test fixtures.

**Flipping a `nativeKinds` bit is not additive**, and P58c flips two. P58b §0.3 already said why that
matters. What is new in P58c is that **both of the kinds it flips are currently load-bearing as
"definitely still Node-served" placeholders elsewhere in the tree**, and one of them is load-bearing
in a spec whose entire purpose is to prove coexistence:

1. `adapterhost.TestKindNodeServed` is the literal `"mongodb"` (`router.go:28`), introduced by
   P58b B16 *precisely so that a later flip would be a one-line change* — and P58c is the sub-phase
   that has to make that change. Five files consume it symbolically (§1.8).
2. `tests/e2e-real/mariadb-real.spec.ts`'s second test — **checkpoint C1b itself**, the only proof in
   the entire phase that P58 D4's coexistence property holds in a running app — uses a **MongoDB**
   connection as its Node-served side, kills the Node child, and asserts MongoDB flips to `error`
   while MariaDB stays connected. The moment `nativeKinds["mongodb"] = true` lands, that test asserts
   nothing about coexistence: both connections are native, both survive the kill, and the test goes
   green for the wrong reason (§1.9).

Three structural answers, all in §9's commit list rather than in anyone's vigilance:

1. **Both placeholders move in M7.1, in their own commits, before either flip** (C14, C15), and
   M7.1's acceptance check is that `grep -rn '"mongodb"\|"redis"' shell/internal tests/e2e-real`
   returns only the two entries that are supposed to survive (§8).
2. **Each kind flips in its own commit**, at the end of its own milestone (C19).
3. **The Go acceptance spec lands and fails before its adapter** (P58 D12 / its R3), per adapter.

## 1. What re-reading the tree found

### 1.1 The parent's grouping justification, checked — and it is half right in both halves

**"A page shape the SQL family never does."** Half right, and the difference is worth being exact
about because it removes work rather than adding it.

- The *builders* already exist. P58a M2 ported all four of `page.ts`'s builders, not just the
  tabular one: `internal/page/builder.go:211`'s `NewDocumentPageBuilder(singleRow bool)` and
  `:280`'s `NewKeyValuePageBuilder(redisType string, ttlMs, memoryBytes *int64, singleRow bool)` are
  present, complete, with their `MarshalJSON` wire shapes (`"kind": "document"` / `"kind": "keyvalue"`,
  the `ids`/`bodies` and `fields`/`values` chunk pairs, `redisType`/`ttlMs`/`memoryBytes`). Neither
  has ever been *called* by a native adapter, and `page_test.go` exercises the codec, not these two
  builders' own wiring. So the honest restatement: **P58c writes no page code; it is the first
  sub-phase to exercise two builders that were written in P58a and have been dead ever since.**
- What genuinely is new on the wire: **`pagination: "cursor"`** (both `mongoCaps` and `redisCaps`;
  `adapters.PaginationCursor` exists as a constant in `caps.go:13` and has never been emitted), and
  **`keyBrowser: true`** — `redisCaps.keyBrowser` is `true` (`redis/caps.ts:11`), which routes a db
  index's key namespace into a **Browse tab** (§8.18) rather than the project tree. Redis is the
  first native adapter to drive `src/renderer/views/browse/`, and the browse tier is also the only
  consumer in the app of `TreeChildren.Truncated` — for which `redis/catalog.ts`'s
  `MAX_SCAN_ROUNDS` cap is the **only producer anywhere in the eleven adapters**
  (`project/state/tree.ts:104-107`'s own comment says so). Both need real coverage; neither needs
  new substrate.

**"An original parser, twice."** Right once, and generously the second time.

- `mongo/literal.ts` is 338 lines: a tokenizer with seven lexical states (whitespace, `//` and `/* */`
  comments, punctuation, single- **and** double-quoted strings with a nine-entry escape table plus
  `\uXXXX`, numbers including a leading `-`, identifiers over `[A-Za-z_$]`), a recursive-descent
  parser over objects/arrays/values with JSON5-style trailing commas, a closed six-entry BSON
  constructor table, and a second pass (`resolveEjsonWrappers`) that walks the parsed tree replacing
  thirteen extended-JSON wrapper shapes. It clears `AGENTS.md`'s unit-test bar without argument and
  P58 D11 already says so.
- `redis/console.ts`'s `tokenize` is **33 lines** (`console.ts:15-48`): whitespace-separated tokens
  with optional single/double quoting and backslash escapes inside quotes, and one error
  (`unterminated quoted string`). That is not `literal.ts`'s peer and this plan does not pretend it
  is. It gets a small table-driven test (C12) on the narrower ground that it is the console's entire
  input path and has three interacting rules, not because it is a second D11.

So P58c's real shape is: **one large parser, two value codecs, two cancellation stories that share
nothing, and the first exercise of two dead page builders.** The parser is M7.2's whole milestone;
the value codecs are §1.4 and §1.7's findings; the cancellation stories are C6 and C9.

### 1.2 The two adapters, measured

`git grep -c "" -- src/engine/adapters/<dir>` for this plan. **18 files, 2 535 lines**, matching the
parent's §1.1 totals exactly (1 382 + 1 153).

| File | mongo | redis |
|---|---:|---:|
| `index.ts` | 255 | 174 |
| `read.ts` | 182 | **394** |
| `console.ts` | 183 | 106 |
| `mutate.ts` | 149 | 132 |
| `catalog.ts` | 76 | 118 |
| `client.ts` | 70 | 160 |
| `definition.ts` | 78 | — (`definition: false`) |
| `errors.ts` | 22 | 27 |
| `caps.ts` | 29 | 42 |
| `literal.ts` | **338** | — |
| **subtotal** | **1 382** (10 files) | **1 153** (8 files) |

Two shapes worth naming before anyone starts, because they invert the intuition the line counts give:

- **`redis/read.ts` is the single largest non-parser file in either adapter (394 lines)** and it is
  not one algorithm — it is six, one per redis type, sharing exactly one helper
  (`readScanFamily`, used by hash/set/zset) and nothing else. `readList` is offset-only, `readStream`
  is `XRANGE` with a `+1` probe, `readString` is unpaged. Six type dispatches, four *different*
  `PagePosition` shapes, and three mutually incompatible cursor contracts. It is the file to write
  last and review hardest.
- **`mongo/console.ts` (183 lines) is bigger than `mongo/read.ts` (182)** because it dispatches ten
  shell methods, each with its own argument arity, its own result shape, and its own answer to
  "does the driver accept a cancellation signal for this one". §1.6.

**Expected Go size.** The two calibrations this repo has: P58a's Postgres port ran 1.26× the
TypeScript (1 726 → 2 176 product lines + 762 test); P58b's three ran roughly the same. Applying it:
**~1 750 for `mongo`, ~1 450 for `redis`**, plus ~1 400 of Go test. Two adjustments in known
directions: `mongo/literal.go` will run *longer* than 338×1.26 (Go has no regex-literal
character-class shorthand at the tokenizer's hot spots and no `Record<string, fn>` constructor table
without an explicit type), and `redis/client.go` will run *shorter* (ioredis's two-listener
`initError` race, `client.ts:98-118`, has no Go analogue at all — C8).

### 1.3 What the substrate already gives P58c for free — and the four gaps

Read out of `shell/internal/`, not inferred.

**Free, already built, no change needed:**

| Needed by P58c | Where it already is | Notes |
|---|---|---|
| `Adapter`, `Caps`, `Deps`, `OpCtx`, `ConnectInfo`, `ReadRequest`/`CountRequest`/`CountResult`, `TreeChildren` | `internal/adapters/adapter.go` (200 lines), `caps.go` | Both implement the interface verbatim. `Caps.Pagination` already has the `PaginationCursor` constant (`caps.go:13`) |
| The eight error codes, `Error`, `New`, `CodeOf`, `Unsupported`, `NoQueryConsole`, `AssertWritable`, `CheckNotStarted`, `CheckCancelled`, `RequireConnected` | `internal/adapters/errors.go` | Both `errors.ts` ports map onto this closed set |
| `Register(kind, ctor)` from each package's own `init()` | `internal/adapters/registry.go` | **No edit to `registry.go`.** `shell/main.go` gains two blank imports (§4.6's most-forgotten step) |
| `adapters.RunWithAbortRace` | `internal/adapters/abort.go` (45 lines, P58b B14) | Both adapters need it, for the two opposite reasons C6 and C9 give |
| `EncodePageToken` / `DecodePageToken` / `RequestFingerprint` / `SafeInt` | `internal/adapters/sqltext.go:61/73/93/132` | The **only four** of `sqltext.go`'s eighteen functions either adapter touches |
| `NewDocumentPageBuilder`, `NewKeyValuePageBuilder`, `UnpagedPosition`, `PagePosition`, the chunk codec and its base64 wire form | `internal/page/builder.go:211/280/43`, `chunk.go` | §1.1 — present, complete, never yet called |
| L2/L3 cache, cache-aside discipline, op scheduler, panic boundary, `op:start`/`op:end`, the data-op dispatcher, request `Validate()`s, the per-kind router, the single-writer stream session | `internal/enginecache/`, `internal/adapterhost/` | None of it is kind-specific |
| `model.NodePath`/`PathSegment`/`TreeNode`/`ObjectMeta`/`ObjectDefinition`/`DocumentSchemaMeta`, `model.MutationPlan`/`MutationRowOp`/`MutationResult`, `model.RowValues` (order-preserving, P58a A4), `model.PageCursor`, `model.ConsoleRequest`, `model.SortSpec` | `internal/storage/model/` | Every type both adapters name. `RowValues`'s order-preservation is what makes redis's `_key`/`$value` and mongo's `$document` sentinels readable at all |
| `testsupport.IsDockerAvailable`, `DockerUnavailableMessage`, `fixture[T]`'s memo + `TestMain` teardown rule (P58b B15), the repo-root seed-path resolver | `internal/adapters/testsupport/fixture.go`, `postgres.go` | Two new fixtures plug straight into `fixture[T]` |
| The renderer's dual chunk decoder | `src/renderer/bridge/port.ts`'s `toTypedArray` | **Verified present** at `223cf02`, both branches. This is why P58c touches no `src/` file (C22) |

**Explicitly *not* used, and this is the first sub-phase where that is true of most of the
substrate:** the entire keyset planner — `ComputeEffectiveOrder`, `AssertKeysetSupported`,
`ResolveFetchColumns`, `BuildScanOrderBy`, `BuildKeysetPredicate`, `BuildKeysetPosition`,
`ResolveProjection`, `ResolveKeyShape`, `PrimaryKeyFromIndexes`, `WhereClause`, `ParseCountValue`,
`BuildOrderBy`, `StripOneTrailingSemicolon`, `SingleStatusPage` — and **all nine** of
`sqlmutate.go`'s exported functions. Mongo builds its own `PagePosition` literal by hand
(`read.ts:126-147`) with an `_id`-keyset rule the SQL planner cannot express; redis builds four
different ones. Neither renders SQL, so neither needs `OrderedOps`, `RenderRowOp`,
`LiteralRenderer`, `AssertKeyIsPrimaryKey` or `AssertAffectedExactlyOne`. **That is not an omission
to fix and no part of this plan should "unify" the two page-position constructions into
`sqltext.go`** — P58b B13 made the same call for ClickHouse's literal renderer and was right.

**Not free — the four gaps, all small, all M7.1:**

1. **`adapterhost.TestKindNodeServed` is `"mongodb"`** (`router.go:28`) — §1.8, C14.
2. **`tests/e2e-real/mariadb-real.spec.ts`'s coexistence half uses MongoDB** — §1.9, C15.
3. **`testsupport/spec.go` reads only a `TabularPage`.** `CellAt(t, p page.TabularPage, col, row)`
   (`spec.go:42`) is the whole cell-reading surface; `ChildNames`/`ContainsName`/`Seg`/`NodePath`/
   `Strp` are page-agnostic. The TypeScript side already has the analogue this needs —
   `tests/db/support/page.ts`'s `readDocument`/`readKeyValue` plus `mongo.spec.ts`'s
   `docIdAt`/`docBodyAt` and `redis.spec.ts`'s `kvPairs` — and two Go suites writing their own copies
   is two chances to get the null-vs-empty distinction wrong in a helper.
4. **`Router.childrenNative` does not normalize `TreeChildren.Nodes`.** `describeNative` and
   `definitionNative` both call `model.ValidateObjectMeta`/`ValidateObjectDefinition`
   (`router.go:305`, `:352`), added at P58b's own closeout for exactly the nil-slice-marshals-as-`null`
   hazard; `childrenNative` (`router.go:240-259`) returns `adapters.TreeChildren` straight through
   with no equivalent. §1.5 is why that matters *specifically* for these two adapters.

### 1.4 `bson.MarshalExtJSON` is not obviously `EJSON.stringify`, and three specific ways it can differ

This is the largest single risk in the MongoDB half, it is the exact hazard `AGENTS.md`'s P58b M6.3
finding warns about (*"an M6.0-style probe is only as complete as the specific inputs it tried"*),
and it is why MG-1 is written the way §6 writes it.

`mongo/read.ts` renders **every** document body and **every** `_id` through
`EJSON.stringify(value, { relaxed: false })` (`read.ts:15`, `:120`); `mongo/console.ts` does the same
for every console result document and status document (`console.ts:74-85`); `mongo/definition.ts`
uses the *relaxed*, 2-space-indented form for the Validation pane (`definition.ts:13`). The Go
analogue P58 §1.8 names is `bson.MarshalExtJSON` — **researched** as to signature
(`MarshalExtJSON(val any, canonical, escapeHTML bool) ([]byte, error)`), **not** as to byte-level
output, which this plan deliberately did not download the module to check. Three ways it can differ,
each of which changes what a user sees:

1. **Numeric-type fidelity, and Go is the *more* faithful of the two.** The JS driver decodes a BSON
   `int32` and a BSON `double` both into a plain JS `number`; `EJSON.stringify`'s canonical mode then
   re-derives the wrapper *from the JS value*, so an integral double comes back out as
   `{"$numberInt":"3"}`. Go decodes into `bson.Raw`, which keeps the on-disk BSON type tag intact, so
   the same value renders `{"$numberDouble":"3.0"}`. **The fixture contains this exact case**:
   `0003_mongo_seed.ts:22` writes `price: (i + 1) * 1.5`, and at `i = 1` that is the JS number `3`,
   stored as a BSON double. So the document view's rendering of `widgets` changes for one in three
   documents on the day M7.3 lands. This is a *gain* in fidelity, not a regression, and it must be
   recorded as a deliberate behaviour change in `docs/ARCHITECTURE.md` and `AGENTS.md` rather than
   discovered by a user — the same standard P58b B4/B22 held its two losses to.
2. **HTML escaping.** Go's `encoding/json` escapes `<`, `>` and `&` by default and
   `MarshalExtJSON`'s third parameter is what turns that off. JS's `JSON.stringify` never escapes
   them. A document containing `"<b>"` would render `"<b>"` in Go and `"<b>"` in JS. The
   fixture has no such value today, which is precisely why it would go unnoticed: `escapeHTML` must
   be **`false`**, stated as a decision (C2) and asserted by a Go test with a `<`-bearing document,
   not left to the default.
3. **Field order and whitespace.** `JSON.stringify` emits no space after `:` or `,`; a Go extended-JSON
   writer's spacing is not something to assume in either direction. And **field order is only
   preserved if the document is decoded into an order-preserving type** — `bson.Raw` and `bson.D` do,
   `bson.M` (a `map[string]any`) does not. Decoding into `bson.M` would randomise every document's
   field order on every read, which is the same class of bug P58a A4 identified for `RowValues` and
   the preview dialog, one page kind over. C2 forbids it.

A fourth thing that is *not* a divergence but is easy to get wrong: `definition.ts` uses
`EJSON.stringify(value, undefined, 2, { relaxed: true })` — relaxed **and pretty-printed**.
`MarshalExtJSON` has no indent parameter, so the Go port is `MarshalExtJSON(v, false, false)`
followed by `json.Indent(&buf, raw, "", "  ")`. `mongo.spec.ts` 7's own comment
(`mongo.spec.ts:202`) pins the reason relaxed is deliberate — *"strict EJSON would render a schema's
`minimum: 5` as `{"$numberInt":"5"}` in a pane whose whole job is readability"* — so the two modes
must not be collapsed.

### 1.5 `_id` text is load-bearing in four places, and one of them is the Go parser

`idText(doc)` (`read.ts:14-16`) is the canonical EJSON of `doc._id`, and that one string reaches:

1. **the page's `ids` chunk**, which the renderer's document view shows and which backs *Copy `_id`*
   (P27 D12) — a user pastes that text into the filter box;
2. **the page token**, `encodePageToken([idText(...)], fingerprint)` (`read.ts:136-137`), decoded on
   the next page with `EJSON.parse(rawId)` (`read.ts:63`) and used as a `$gt`/`$lt` boundary;
3. **the mutation key**, which the renderer builds from that same chunk and which
   `mutate.ts:33-48`'s `parseIdKey` parses back with `resolveEjsonWrappers(parseJson5Literal(raw))` —
   i.e. **through `literal.ts`, not through `EJSON.parse`**;
4. `read.ts:65`'s `E_QUERY 'malformed page token'`, the only place the two paths' disagreement would
   surface, and it surfaces as a generic message with no diagnostic.

So the Go port has a closure requirement the TypeScript satisfies only by coincidence of having two
compatible parsers in one package: **whatever `IDText` emits, `literal.go` must accept, and the
result must be a value the driver will match against.** A `{"$oid":"…"}` string produced by Go's
canonical extended JSON must survive `ParseJSON5Literal` → `ResolveEJSONWrappers` and come back out
as an `ObjectID`. C3 states it; §5.3 makes it a structural test over every seeded document rather
than a spot check, because the fixture deliberately contains `_id`s that are `ObjectId`s
(`widgets`, `big_widgets`, `oversized_widgets`) *and* ones that are plain integers
(`mongo.spec.ts` 13/14/15's `mutate_probe`, whose `_id`s are `0` and `1`, keyed with
`EJSON.stringify(0)` — `mongo.spec.ts:511`, `:566`).

### 1.6 MongoDB's cancellation is two mechanisms, and only one of them ports cleanly

`docs/ARCHITECTURE.md`'s per-database table gives MongoDB's cancel mechanism as *"`AbortSignal` on
the cursor, `killOp` fallback"*, and `index.ts:190-226` is the fallback's implementation. Read for
this plan:

- **Layer 1, the signal.** `ctx.signal` is passed as the driver's own `Abortable` option to
  `find`, `findOne`, `countDocuments` and `aggregate` — and to **nothing else**. `read.ts:174-176`,
  `mutate.ts:101-102` and `:134-135` and `console.ts:94-98` each carry a comment saying so:
  `insertOne`/`insertMany`/`updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`replaceOne` and
  `estimatedDocumentCount` take no signal at all. In Go this stratification **disappears** —
  `context.Context` is the driver's universal first parameter — which is a simplification, but see
  the next bullet before treating it as free.
- **Layer 2, `killOp`.** Every operation the adapter issues carries `comment: ctx.opId`.
  `cancel(opId)` runs `$currentOp: {allUsers: false, idleConnections: false}` as an **aggregation
  stage on the `admin` database**, `$match`es `command.comment == opId`, and issues
  `{killOp: 1, op: <opid>}` for each hit. Two properties of that design are deliberate and both are
  documented in place (`index.ts:190-195`): the `$currentOp` *stage* with `allUsers: false` needs no
  privilege at all, unlike the legacy `currentOp` *command*, which needs the clusterMonitor-only
  `inprog` privilege — and the fixture's own user is an unprivileged `readWrite`-on-two-databases
  `kira` (`tests/db/support/mongo.ts:63-70`), so this is not a theoretical distinction; and `opid`
  is deliberately typed `unknown` and round-tripped verbatim (`index.ts:28-32`: *"Not necessarily a
  plain number (can be a compound shard-qualified value)"*).
- **The hazard the Go port introduces, and it is P58b §1.7's third row exactly.**
  `adapterhost.Host.CancelOp` cancels the op's own context **first**, then calls
  `adapter.Cancel(opID)`. If that context reached `mongo-driver` directly, the driver would abort the
  operation client-side and the server-side op would be gone from `$currentOp` — or, worse, still
  running with its client gone — by the time `killOp` looked for it, so `Cancel` would find nothing,
  report `false`, and the caller would get no confirmation. That is the same failure P58a's
  `TestPostgres_Cancel` caught for pgx and P58b's B6 pre-empted for `go-sql-driver`. **C6:**
  `mongo` never passes the op's context to the driver; every call goes through
  `adapters.RunWithAbortRace`.
- **The liveness check in the cancel test is already id-keyed, and must stay that way.**
  `mongo.spec.ts` 22 polls `{currentOp: 1, 'command.comment': opId}` — a tracked operation id, not a
  text pattern over the statement. That is exactly what `AGENTS.md`'s P58b M6.4 finding says a
  server-side liveness poll must do (*"a server-side liveness poll must check a value the checking
  statement's own text cannot itself satisfy"*), and the Go port must not "simplify" it into a
  `$where`/`ns`/command-text match, which is how the ClickHouse version went wrong. §5.3 states it as
  a rule.
- One environment fact the port inherits: scenario 22's slow operation is
  `$expr: {$function: {body: "…", lang: "js"}}`, which needs server-side JavaScript enabled.
  `mongo:7` enables it by default and the existing spec passes today; MG-2 confirms it rather than
  assuming, and names the alternative (a large `$where`-free aggregation over `big_widgets` with a
  `$function`-free CPU sink) if it does not.

### 1.7 Redis's cancellation is honestly *not* a server-side kill — and `docs/ARCHITECTURE.md` says otherwise

`redis/index.ts:150-152`:

```ts
async cancel(): Promise<boolean> {
  return false;
}
```

…with a nine-line comment above it (`index.ts:140-144`) explaining that this is permanent, not a gap:
*"every op this adapter issues is either a bounded SCAN-family loop (checks the signal between
rounds) or a single fast command — the signal check is fully sufficient on its own, so this stays a
permanent no-op rather than attempting a `CLIENT KILL` that would be unsafe under
`DbConnectionSet`'s one-connection-per-db-index sharing (P9's D7)."* `redisCaps.cancel` is
nonetheless `true` (`caps.ts:40`), and that is also deliberate: the cap describes whether pressing
stop does something real, and it does — `adapterhost.Host.CancelOp`'s **first** step is the whole
mechanism here.

**`docs/ARCHITECTURE.md`'s per-database mapping table is stale on this point.** Its Redis row reads
*"abort the SCAN loop; `CLIENT KILL` for blocking cmds"* — the adapter has never issued
`CLIENT KILL`, and P9 D7 is the decision that says it never will. `tests/db/redis.spec.ts` 21's own
name (*"cancel is a permanent no-op (D7/D8)"*) is the tree's own contradiction of the table. P58c
owns this cell and fixes it (§8 criterion 9).

**The Go-specific question C9 has to answer, and it is the opposite of Mongo's.** ioredis takes no
cancellation signal at all, so today *no* cancellation reaches the driver and the loop's
`throwIfCancelled(ctx)` between SCAN rounds is the entire mechanism. go-redis, by contrast, takes a
`context.Context` on every command. Three options:

| Option | What it buys | What it costs |
|---|---|---|
| Pass the op ctx straight to go-redis | A single long command (a 10 000-element `LRANGE`, a console `DEBUG SLEEP`) becomes interruptible for the first time | A context-cancelled RESP command leaves the connection's stream desynchronised; go-redis's own handling of that (does it discard the connection, or hand a poisoned one back to the pool?) is **not verified for this plan** and is RD-1(c) |
| `RunWithAbortRace` on a detached context + `CheckCancelled(ctx)` between SCAN rounds | Behaviour identical to the TypeScript adapter's, verbatim; no poisoned connection is possible | A single long command still runs to completion server-side after the caller unblocks — exactly as today |
| Both: detached for single commands, op-ctx for the SCAN loop | Nothing the second option does not already give (the loop's between-round check already stops it) | Two mechanisms in one adapter for no gain |

**C9 takes the second**, on P58 §0.2's rule (*"where an adapter's TypeScript encodes a hard-won
behaviour … the Go port reproduces it"*) and because the first option's cost is a real risk with an
unverified mitigation. RD-1(c) measures it anyway, so that if the answer turns out to be "go-redis
discards the connection cleanly and the pool refills", a later phase can revisit with evidence
rather than argument.

### 1.8 Flipping `"mongodb"` and `"redis"`: the grep, done before writing §3

`grep -rn '"mongodb"\|"redis"' shell/internal --include=*.go`, run for this plan exactly as
`AGENTS.md`'s P58a/P58b findings require:

| File:line | What it is | Fate |
|---|---|---|
| `internal/adapterhost/router.go:28` | `const TestKindNodeServed = "mongodb"`, with a doc comment reading *"currently P58c's MongoDB"* | **Must move in M7.1** (C14) |
| `internal/storage/model/connection.go:49` | the valid-connection-kind set | Correct, untouched |

That is the **entire** literal-string surface — a direct dividend of P58b B16, which is exactly what
it was introduced for. Five files consume the constant symbolically and need no edit at all
(`connections/service_test.go:63,82,114,225`, `tree/service_test.go:51,66`,
`adapterhost/integration_test.go:23`, `adapterhost/dataframe_test.go:107`,
`adapterhost/router_test.go:23,24,37`) — though `service_test.go` and `tree/service_test.go`'s
comments say *"adapterhost.TestKindNodeServed is not in nativeKinds"*, which stays true only if C14
lands first.

`router_test.go`'s second, narrower hazard — the one P58b M6.2's findings had to fix live — is
already immune: its `IsNativeKind` mutation test uses `const fakeKind = "kira-test-fake-kind"`
(`router_test.go:31`), a string that can never become a real adapter kind, with a comment saying why.
**Nothing in M7.1 should touch it**, and the plan says so here so nobody "tidies" the two placeholder
concepts back into one.

**C14 moves `TestKindNodeServed` to `"kafka"`**, not to `"redis"` (which this very sub-phase makes
native) and not to a P58d kind (`sqs`/`s3`/`rabbitmq`, all native one sub-phase later). Kafka is
P58e's, the last kind to go native, so this is the last time the constant has to move before P58f
deletes the concept — and its doc comment is rewritten to name **P58e** as the next mover.

### 1.9 Checkpoint C1b's own spec stops proving anything at M7.3, and it is the phase's only running-app coexistence proof

`tests/e2e-real/mariadb-real.spec.ts:133` — the test's own title:

> `C1b: MariaDB (native) survives killing the Node engine child; MongoDB (Node-served) does not`

Its second test creates a **MongoDB** connection through the real dialog
(`[data-testid="connection-kind-mongodb"]`, line 169), connects it against a real `mongo:7` container
started by `tests/e2e-real/support/mongo.ts` → `tests/db/support/mongo.ts`, expands its tree to
`database:kira_test/collection:widgets`, renders a `[data-testid="document-tree"]` row, then
`SIGKILL`s the Node engine child and asserts MongoDB's status dot flips to `error` while MariaDB's
stays `connected` and still serves a read after a `page.reload()`.

`AGENTS.md`'s P58b findings call that *"the first time P58 D4's coexistence property has been proven
in a running app, not only in `adapterhost`'s own router unit tests."* **The moment
`nativeKinds["mongodb"] = true` lands, it proves nothing**: both connections are native, the Node
child serves neither, both survive the kill, and the assertion `data-status = "error"` fails —
loudly, which is the good case — or, if someone "fixes" it by relaxing the assertion, silently, which
is the bad one.

**C15 re-points it in M7.1**, in the same commit as C14, before either flip. The Node-served side
becomes **Kafka**, for the same reason C14 picks kafka: it is the last kind to go native (P58e), so
this is the last move before P58f retires coexistence entirely. `tests/e2e-real/support/mongo.ts`
(a two-line re-export of `tests/db/support/mongo.ts`) is replaced by an identically-shaped
`support/kafka.ts` over `tests/db/support/kafka.ts`, the connection-kind testid becomes
`connection-kind-kafka`, and the "renders a page from the Node-served side" step becomes a stream
view over a seeded topic rather than a document tree.

Three things the implementer must check while doing it, each of which P58b's own §13 records as
having cost an iteration:

- **The database-name collision is gone and a new one is not introduced.** P58b's §13 records three
  locator iterations caused by MariaDB and MongoDB both seeding a database literally named
  `kira_test`; Kafka's tree is `cluster → topics`, with no `database:` segment at all, so the
  `[data-path="database:kira_test"]` ambiguity disappears. Do not re-introduce it by reusing the
  MariaDB row's own locator shape.
- **The Kafka container is heavier than Mongo's.** `confluentinc/cp-kafka:8.0.7` via `mirror.gcr.io`
  (already namespaced — no `library/` prefix, `AGENTS.md`'s Docker section). Budget accordingly in
  the one Bash invocation §7 runs in.
- **The `-tags server` binary loads the Kafka native addon through the vendored Node, not Bun.**
  `AGENTS.md`'s Native Kafka driver section: the addon loads under the vendored real Node with no
  rebuild step, which is exactly the runtime the engine child uses. This is the one point where
  Kafka is a riskier choice than RabbitMQ; **RabbitMQ is the named fallback** (no driver at all, an
  HTTP management API, a `rabbitmq:4.3.5-management-alpine` container that `tests/ipc/rabbitmq/`
  already starts here for real), at the cost of having to move again at P58d. OQ-3 raises the choice
  to the parent's author.

### 1.10 Two claims from P58b's own closeout do not hold in the tree, and P58c inherits both

Checked with `git log --diff-filter=D --name-only -- tests/db/` and `ls`, because P58c's own M7
mandate ends with a spec deletion and this plan should not inherit a precedent that was never set.

1. **P58b's four `tests/db/*.spec.ts` deletions never landed.** B17 and its §3 target tree and its §8
   per-milestone criteria all say `mariadb.spec.ts`, `mysql.spec.ts`, `sqlite.spec.ts` and
   `clickhouse.spec.ts` are deleted in their milestones' last commits. At `223cf02` **all four are
   still in the tree** (54 844 / 64 291 / 58 617 / 60 816 bytes), and the only `tests/db/*.spec.ts`
   ever deleted in this repository's history is `postgres.spec.ts` (at `ce4585a`, P58a M5). So
   `bun run test:db` still runs four full container suites against TypeScript adapters that no
   longer serve a single real connection in the app. This is not P58c's to fix — but it is P58c's to
   **name**, because (a) M7's own mandate ends with the same instruction, (b) an implementer who
   greps for the precedent will find it absent, and (c) leaving it unrecorded is how a plan's
   closeout claim becomes folklore. OQ-1.
2. **`docs/ARCHITECTURE.md`'s per-database mapping table was only half updated.** P58b §8 criterion 9
   requires *"the per-database mapping table's SQLite **Cancel mechanism** cell (no longer 'none')"*.
   The per-engine SQLite section (line 211) was rewritten in full and is excellent; the mapping
   table's own SQLite cell (line 96) still reads *"none — SQLite has no interruptible statement
   (`sqlite3_interrupt` doesn't exist in `node:sqlite`, and the whole API is synchronous)"*. Since
   P58c edits that same table for Redis (§1.7) and MongoDB, fixing SQLite's cell in the same commit
   costs one line. OQ-2 asks whether that is in scope; this plan's §8 assumes yes.

**And the "its only consumer goes" claim, re-grepped for P58c's own two support modules** — the
mistake `AGENTS.md`'s P58a findings name explicitly (*"a plan's own 'its only consumer' claim about a
shared support file is a snapshot, not a standing fact"*):

| Support file | Consumers other than its own `tests/db/*.spec.ts` | Fate |
|---|---|---|
| `tests/db/support/mongo.ts` | `tests/e2e-real/support/mongo.ts` → `tests/e2e-real/mariadb-real.spec.ts` (checkpoint C1b), `scripts/capture-tree.ts:48` | **KEEP** — and note that C15 removes the first of those two, leaving `capture-tree.ts` |
| `tests/db/support/redis.ts` | `tests/ipc/redis/redis.backend.spec.ts:17`, `scripts/capture-tree.ts:50` | **KEEP** |
| `tests/db/fixtures/{0003_mongo_seed.ts, 0004_redis_seed.ts}` | both support modules; and `redis.spec.ts` imports **thirteen** exported constants from `0004` directly | **UNCHANGED** — P58 D12's rule is that the Go seeders reproduce the same dataset; §4.5 |

The seed files are TypeScript functions, not `.sql` — so unlike P58a/P58b, **the Go seeders cannot
read the same file**; they must re-express it. C21 states the consequence and §4.5 makes the exact
constants a checklist rather than a memory.

### 1.11 `tests/ipc/redis/`'s backend half, and the two non-determinism freezes P58f will inherit

Same shape as P58b §1.10, one adapter instead of three, plus one thing no other adapter has.

`tests/ipc/` has seven adapters; **`redis` is one of them, `mongo` is not** (mongo, like postgres and
sqlite, has no `tests/ipc/` split). After M7.4 the real app serves redis from Go while
`tests/ipc/redis/redis.backend.spec.ts` keeps asserting against the TypeScript adapter — the
anti-drift guarantee `docs/ARCHITECTURE.md`'s Testing section states still holds, for a producer that
no longer runs in production. P58 D13's generator port is P58f's and nothing here should bring it
forward.

What is worth recording now, because it is the hardest fixture in the tier and P58f will have to
reproduce it in Go: **redis's fixture contains a deliberately synthetic page.**
`redis.backend.spec.ts` carries two freezes with their reasoning in place —
`sortKeyValueFields` (lines 58-76: two consecutive `KIRA_IPC_FIXTURES=write` runs against fresh,
identically-seeded containers returned the same 5 000 hash fields in different orders) and
`syntheticHashPage` (lines 78-100: sorting was **not enough** — which of a 5 000-field hashtable's
fields land on which side of an HSCAN cursor boundary depends on Redis's internal bucket/rehash
state, so the committed fixture's field/value content and cursor tokens are a deterministic
stand-in, while the *real* HSCAN result is still asserted against at the call site). Line 259's
comment carries the third half of the same finding: **HSCAN's `COUNT` is a hint, not a guarantee** —
Redis walks buckets, not elements, so *"a hashtable-encoded 5 000-field hash can return well over
the requested pageSize in a single round. The only real invariant here is 'some rows, more to
come'."*

That last sentence is the single most important constraint on the Go acceptance suite's own
hash-paging test (§5.4), and it is why RD-1(b) exists: **any Go assertion of the form
`len(page.Fields) == pageSize` for a hash/set/zset read is wrong**, and `readScanFamily`'s own
comment (`read.ts:79-88`) says why it is wrong on purpose — the loop accumulates whole SCAN rounds
without slicing mid-round, so a page can overshoot `req.pageSize` by up to one `SCAN_COUNT`.

### 1.12 The two specs, counted, and how much of each ports

Counted for this plan (`grep -c '^\s*\(test\|it\)('`) and read scenario by scenario.
**1 695 lines, 50 scenarios** — a third of P58b's 161, and the smallest test-porting job since P58a.

| Spec | Lines | Scenarios | Ports as-is | Re-baselined against the Go driver | Moves to `adapterhost` / becomes a caps assertion | Rewritten, each with a reason |
|---|---:|---:|---:|---:|---:|---:|
| `mongo.spec.ts` | 913 | 26 | 21 | 2 (2, 18) | 2 (4, 21) | 1 (16 — its *name*, not its assertion) |
| `redis.spec.ts` | 782 | 24 | 20 | 1 (2) | 3 (4, 20, 22) | 0 |

The columns, explained once:

- **Ports as-is** — drives the adapter against the same seeded dataset and asserts a shape, a cell
  value or a count. Reuse `testsupport`'s helpers (gap 3, §1.3) rather than writing per-package
  copies.
- **Re-baselined against the Go driver, never loosened** (P58 §1.10's first non-portable point).
  Mongo 2 asserts `E_AUTH` off `MongoServerError.code === 18|13`; Go's equivalent is
  `mongo.CommandError`/`mongo.ServerError` and its own message wording. Mongo 18 asserts the exact
  message *"expected delete to affect exactly one document, deleted 0"* — that one is the
  **adapter's** own string, not the driver's, and must port **byte-identically**, not be
  re-baselined; the re-baseline in scenario 18 is only its `E_QUERY` path for a driver-level failure.
  Redis 2 asserts `E_AUTH` off ioredis's `ReplyError` and the `NOAUTH|WRONGPASS|NOPERM` prefix test
  (`errors.ts:18`); go-redis surfaces RESP errors as `redis.Error`, a string type, so the prefix test
  ports as a string-prefix check over the error text, re-derived against a real wrong-password
  connection.
- **Moves out of the adapter package.** Scenario 4 in both files is *cap honesty* — a one-line
  comparison against the caps literal. Mongo 21 / redis 20 (*"an already-cancelled signal rejects
  before running anything"*) is a test of `adapters.CheckNotStarted` plus the scheduler; keep a
  three-line case per adapter anyway, as the cheapest possible proof that the adapter honours
  Adapter rule 2. **Redis 22** is different and worth naming: it imports
  `handleMutate`/`handleRead` from `src/engine/data.ts` directly (`redis.spec.ts:9`) to pin P43
  F12/D17's *"a partially failed mutate still invalidates the target's cached page"* — that subject
  moved to `adapterhost` in P58a M4 and is **already covered** by
  `adapterhost/data_test.go:121`'s `TestDispatcher_Mutate_InvalidatesEvenOnFailure`. It is deleted,
  not ported, and §5.4 records that the coverage exists rather than leaving it implied.
- **Rewritten.** `mongo.spec.ts` 16's title is *"mutate: insert is unsupported"* and it is stale:
  `mongoCaps.canInsert` is `true` and `mutate.ts:125-141` implements insert. What the scenario
  actually asserts is that an insert whose `values` carry **no `$document` sentinel** is
  `E_UNSUPPORTED` (`mutate.ts:61-64`'s *"document mutation requires a $document body"*). Port the
  assertion verbatim; fix the name.

**The `waitUntil`-on-server-state pattern is the single most valuable thing in both files and ports
verbatim**, exactly as P58a §1.7 and P58b §1.11 said of theirs. Its per-engine form: mongo's is
`{currentOp: 1, 'command.comment': opId}` (§1.6 — already id-keyed, keep it that way); **redis has
none, and correctly so**, because there is no server-side kill to observe (§1.7).

**The false-positive-fixture trap, in its P58c form.** `AGENTS.md` records this pattern twice
(P58a's Postgres `analytics.events`, P58b M6.2's `kira_analytics.events` — both had a real primary
key, so both "no PK" tests passed vacuously) and once as a non-recurrence (M6.3's SQLite, which
already shipped a genuine `no_pk_rowid`). Neither MongoDB nor Redis has a primary-key concept, so the
*literal* trap does not transfer. Its two real equivalents do, and both are sharper:

- **Mongo: `widgets` is asserted by six scenarios and must never be mutated by a seventh.** Scenarios
  8, 9, 10, 10b, 10c, 11, 12 and 23 all assert against `widgets`'s exact 25 documents, their
  `_id` order, and `WIDGET_COUNT`. The TypeScript spec already avoids the trap by creating
  `mutate_probe`, `literal_probe` and `slow_probe` **on the fly, per scenario** — those are the
  direct analogue of P58a's `no_pk_probe`, and the Go port must create them the same way, from the
  root/side client, rather than "simplifying" by reusing a seeded collection. C24.
- **Redis: every mutating test is a fixture mutation, because a redis "table" is the whole
  keyspace.** Scenario 3 asserts the *exact* root listing —
  `rootNamespaces == ['events','queue','session','tags','user']` and
  `rootKeys == ['counter','leaderboard']` (`redis.spec.ts:132-133`) — and scenario 3's own db listing
  asserts `[db0, db1]` exactly. A mutation test that `SET`s a new top-level key, or creates a new
  namespace, or writes into a third db index, silently breaks scenario 3 depending on test order.
  **C23: every mutating redis test runs against db index 1**, which the fixture already seeds with
  one marker key (`other-db:marker`, `tests/db/support/redis.ts:47`) and whose *contents* no scenario
  asserts — only its existence, via `INFO keyspace`, which stays non-empty however many keys a test
  adds. Never db0, and never a new index (a db2 would appear in scenario 3's own database list).
  This is the concrete P58c instance of the pattern, and it is worth stating as a rule because the
  obvious shortcut — "just delete what I created afterwards" — fails under `-race` and under any
  future parallel subtest.

### 1.13 Environment and driver facts checked for this plan

- **Driver versions, researched** against the module proxy's own version list
  (`go list -m -versions`, no download): `go.mongodb.org/mongo-driver/v2` current at **v2.8.2**
  (v1 formally deprecated, as P58 §1.8 says); `github.com/redis/go-redis/v9` current at **v9.22.0**.
  Both confirm P58 D6's rows without amendment — P58c reverses no parent driver decision, unlike
  P58b's B7 and B11.
- **Testcontainers modules, researched**: `modules/mongodb` and `modules/redis` both publish
  **v0.44.0**, matching the `testcontainers-go` core already pinned in `shell/go.mod`. No version
  skew to manage. TC-3 confirms they start *here*.
- **Images**: `mongo:7` and `redis:7` (the exact tags the TypeScript fixtures use —
  `tests/db/support/mongo.ts:9`, `tests/db/support/redis.ts:9`). Both are Docker Hub *official*
  images, so both mirror under `library/` (`AGENTS.md`'s Docker section):
  `mirror.gcr.io/library/mongo:7` and `mirror.gcr.io/library/redis:7`, retagged in the daemon. No Go
  code references the mirror.
- **`mongo:7`'s double-boot wait strategy.** `tests/db/support/mongo.ts:48` waits for
  `/Waiting for connections/` **twice**, with its own comment explaining why: with
  `MONGO_INITDB_ROOT_USERNAME` set, the entrypoint boots a temporary auth-less instance to create the
  root user, shuts it down, then starts the real one with `--auth`. TC-3 must confirm whether
  `modules/mongodb`'s own wait strategy accounts for this — it is the same class of problem P58b's
  TC-2 checked for MySQL/MariaDB, and P58b §1.12 already flagged the general shape (*"the entrypoint's
  init boot runs with networking off"*).
- **`redis:7` needs a password.** The fixture sets one (`PASSWORD = 'kira'`,
  `tests/db/support/redis.ts:10`) so that scenario 2's auth-failure path is reachable at all.
  P58b's own TC-2 finding about `modules/clickhouse`'s `WithPassword("")` (*"does not mean 'no
  password'"*) is a warning worth carrying into `modules/redis`'s `WithPassword`.
- **Neither `./internal/adapters/mongo` nor `./internal/adapters/redis` needs GTK/WebKit headers.**
  Both are pure-Go plus stdlib plus their driver; cgo stays on for the module as a whole
  (`mattn/go-sqlite3` in `internal/storage`, `modernc.org/sqlite` in `internal/adapters/sqlite`,
  Wails' GTK bindings in `internal/shell`), so `CGO_ENABLED=0` is still not an option, but the fast
  loop is `go test ./internal/adapters/mongo` and never `./...`.
- **M7.2 needs no Docker at all.** `literal.go` and `literal_test.go` are pure computation over
  strings and BSON values, exactly like P58b's SQLite milestone was Docker-free. That makes M7.2 a
  good milestone for a session on which the daemon will not start.

## 2. Decisions

**C1 — MongoDB's driver is `go.mongodb.org/mongo-driver/v2` (v2.8.2), confirming P58 D6's row
without amendment.** The official driver, v1 formally deprecated, and the only one whose `bson`
package can express the `_id`/document rendering the whole adapter is built on (§1.4). Unlike P58b's
B7 and B11, this sub-phase reverses no parent driver decision and OQ-4 is a question about a
*consequence* of the decision, not the decision.

**C2 — a Mongo document is decoded as `bson.Raw` and rendered with
`bson.MarshalExtJSON(raw, /*canonical=*/true, /*escapeHTML=*/false)`; never as `bson.M`, and
never with the escapeHTML default.** §1.4, all three points, as one decision because they are one
call site. `bson.Raw` (or `bson.D`, where a value must be constructed rather than read) is the only
shape that preserves both **field order** — observable in the document view, in `ctx.SetCommand`'s
`db.<coll>.find({…})` text, and in the preview dialog — and the **on-disk BSON type tag**, which is
what makes Go's rendering strictly more faithful than the TypeScript's (a stored double `3.0` renders
`{"$numberDouble":"3.0"}` here where JS renders `{"$numberInt":"3"}`). That divergence **is a
behaviour change users will see on `widgets`' own `price` field**, it is a gain rather than a loss,
and it lands in `docs/ARCHITECTURE.md`'s MongoDB section and `AGENTS.md`'s P58c findings as a named
change — the same standard P58b B4/B22 held its two losses to. `escapeHTML: false` gets its own Go
test with a `<`-bearing document, because the fixture has no such value and the default would
otherwise go unnoticed until a user stored one. MG-1 settles the byte-level question before M7.3
writes a line.

**C3 — `IDText` is `MarshalExtJSON` over the `_id` `RawValue` with the same two flags, and
`literal.go` must accept whatever it emits.** §1.5. The closure requirement is structural, not
stylistic: the same string is the page's `ids` cell, the page token's payload, *Copy `_id`*'s
clipboard text, and the mutation key `parseIdKey` parses back **through the literal parser, not
through the EJSON decoder**. §5.3 makes it a test over every seeded document — `ObjectId`-keyed
(`widgets`, `big_widgets`, `oversized_widgets`) and integer-keyed (`mutate_probe`) alike — rather
than a spot check.

**C4 — `mongo/literal.go` is a hand port of `literal.ts`, written first, with its own table-driven
unit test, and it imports no expression evaluator of any kind.** P58 D11, applied. The file keeps
`literal.ts`'s exact five-part structure: `tokenize` (the seven lexical states of §1.1), the
`LiteralParser` recursive-descent core (`ParseValue`/`parseObject`/`parseArray`/`parseKey`, plus the
`ExpectIdent`/`ExpectPunct`/`PeekPunct`/`AtEnd` surface `console.go` drives the statement grammar
with), the six-entry `CONSTRUCTORS` table (`ObjectId`, `ISODate`, `Date`, `NumberLong`, `NumberInt`,
`NumberDecimal`), the thirteen-entry `EJSON_WRAPPER_KEYS` set, and `ResolveEJSONWrappers`. Every
error message ports **byte-identically**, including the position suffixes
(`unexpected character "x" at position 12`, `expected ":" at position 4`,
`unrecognized identifier "foo" at position 0`, `unterminated string literal`,
`unexpected trailing content after literal`) — these are user-facing console errors and P58a A6's
rule for `errors.ts`'s helpers applies here for the same reason.

One Go-specific substitution, stated because a naive port has nowhere else to go:
`resolveEjsonWrappers` calls `EJSON.parse(JSON.stringify(value))` on a matched subtree
(`literal.ts:306`). The Go equivalent is `json.Marshal` the subtree, then
`bson.UnmarshalExtJSON(raw, /*canonical=*/false, &out)` — **with the same swallow-and-fall-through
on failure** that `literal.ts:307-310` documents (*"The shape matched but the value didn't (e.g.
`{ $oid: 123 }`) — fall through and treat it as a plain object; Mongo will reject a meaningless
filter with its own error"*). Dropping that `catch` would turn a class of bad filter from "Mongo's
own error" into "the parser's error", which is a worse message about a worse thing.

**C5 — `ParseValue`'s number branch produces a float64, not an int64.** `literal.ts:161` is
`Number(t.value)`, so **every** unadorned number in a filter or a document literal is a JS double and
reaches the driver as a BSON double. A Go port that helpfully parses `5` as an `int64` changes what
`{ seq: 5 }` matches against `big_widgets`' own integer `seq` field — silently, in the direction of
matching *fewer* documents, with no error anywhere. `NumberInt(...)`/`NumberLong(...)` exist for
exactly the cases where a user wants otherwise (`CONSTRUCTORS`, `literal.ts:104`/`:103`). This is a
one-line decision with a whole test case behind it (§5.5).

**C6 — MongoDB never passes the op's context to the driver; every driver call runs inside
`adapters.RunWithAbortRace`.** §1.6's third bullet. `adapterhost.Host.CancelOp` cancels the op
context first and calls `adapter.Cancel(opID)` second, and only the second step reaches
`$currentOp`/`killOp`. A ctx-native driver receiving the op's own cancelled context would abort the
operation before `killOp` ever looked for it, `Cancel` would find nothing and report `false`, and the
caller would get no confirmation the server-side work was actually stopped — the identical failure
P58a's `TestPostgres_Cancel` caught for pgx and P58b B6 pre-empted for `go-sql-driver`. The
`release()` argument is used the way `postgres`/`mysqlfamily` use it: the op's `runningByOp` entry is
released when the operation **settles**, not when the context fires.

**C7 — one pooled `*mongo.Client` per adapter instance; no `ConnSet`, no per-database LRU.**
`client.ts:15-17`'s own reasoning ports verbatim: *"the driver's own internal pool handles
concurrency, so there is no ConnectionSet/LRU analog to MariaDB's (`client.db(name)` is a cheap
synchronous handle-get, not a new connection)."* `client.Database(name)` is the same cheap handle in
Go. P58 D20's *"no adapter gains a connection pool it does not have today"* is satisfied by **not**
changing anything: Mongo's driver has always pooled, and the adapter has always let it. Do not set
`SetMaxOpenConns`-style caps that have no analogue here, and do not build a `ConnSet` because three
other adapters have one.

**C8 — Redis's driver is `github.com/redis/go-redis/v9` (v9.22.0), and `DbConnectionSet` ports as
written — one client per logical db index, bounded at 8, LRU-evicting anything but the primary.**
`client.ts:63-67`'s reason is explicit and is a real design constraint, not a habit: *"one distinct
ioredis client per db index, each carrying its own `db` option baked in at construction rather than
sharing one connection and issuing a runtime `SELECT` — the same reason MariaDB's ConnectionSet holds
one Connection per database rather than one shared connection running `USE`."* go-redis's
`Options.DB` is the same construction-time field, so this is a direct translation. What **does not**
port is ioredis's `initError` race (`client.ts:98-118`: a `once('error')` listener capturing the real
`WRONGPASS` reply because `connect()`'s own rejection is a generic *"Connection is closed"*, plus a
permanent `on('error')` listener because an unhandled `'error'` event would crash the process) —
go-redis returns the real error synchronously from the first command and has no process-level error
event. **Delete both, do not port them**, the same call P58b B24 made for the `mariadb` driver's
TLS-handler race.

**C9 — every redis command runs through `adapters.RunWithAbortRace` on a detached context, with
`adapters.CheckCancelled(ctx)` between SCAN rounds; `Cancel(opID)` stays a permanent `false` and
`caps.cancel` stays `true`.** §1.7, with the three-option table and the reasoning. This reproduces
the TypeScript adapter's behaviour exactly — cancellation unblocks the caller and stops the loop at a
round boundary, and no in-flight RESP command is ever aborted mid-stream — and it makes a poisoned
pooled connection structurally impossible rather than merely unlikely. The named alternative
(passing the op ctx to go-redis, which would make a single long `LRANGE` or a console `DEBUG SLEEP`
interruptible for the first time) is deliberately **not** taken in P58c because its cost is
unverified; RD-1(c) measures it anyway so that a later phase can revisit with evidence.
`redis/index.ts:140-144`'s nine-line comment ports with the `Cancel` method, updated to name
go-redis instead of ioredis, so the next reader finds the reasoning rather than an unexplained stub.

**C10 — the redis client is configured with `Protocol: 2` explicitly.** go-redis v9 supports RESP3
and, to this plan's understanding, defaults to it — **not verified against the module source, which
this plan deliberately did not download; RD-1(d) settles it.** The reason to pin RESP2 regardless is
that the *console* path is a generic `client.Do(ctx, args...)` whose reply shape is formatted by
`resultToPage`'s array-vs-scalar branch (`console.ts:60-77`) and `formatReplyItem`'s five type
branches (`console.ts:50-56`). Under RESP3 several commands change reply *shape* rather than value —
`HGETALL` returns a map rather than a flat array, `CONFIG GET` likewise, `XRANGE` becomes structured
— so a user typing `HGETALL user:1:profile` into the console would get a different-looking result
page than they get today, for no reason the app chose. Pin RESP2, port `formatReplyItem` onto
go-redis's `any` reply (`nil` → `(nil)`, `string`, `int64`, `[]byte`, `[]any` recursed, everything
else JSON-encoded), and add a **status-reply** branch: go-redis surfaces a RESP simple status
(`OK`, `PONG`) as a plain `string`, which `formatReplyItem`'s first string branch already covers —
confirm rather than assume. C18 keeps `redisCaps` unchanged, so no cap describes this.

**C11 — the per-key metadata triple ports verbatim, including `PTTL`'s sign rule and `MEMORY USAGE`'s
best-effort swallow.** `read.ts:24-55`: `TYPE` first (a `none` reply is
`E_QUERY "key no longer exists: <key>"` — **deliberately not `E_NOT_FOUND`**, P9 D10, because
`viewOp.ts`'s `DISCONNECTED_CODES` must not gate a tab behind "Reconnect & load" for a key that
merely expired); an unknown type is `E_UNSUPPORTED`; `PTTL` mapped `>= 0 ? ptr : nil` (so both
`-1` "no TTL" and `-2` "no key" become a null `ttlMs`); `MEMORY USAGE` in a bare
swallow-everything `catch` (`read.ts:46-48`, *"best-effort (§8.8)"*) because it is unavailable on
some managed Redis offerings and a null memory figure is a fine cell. All three of these look like
sloppiness to a reader who does not know why; all three keep their comments.

**C12 — `redis/console.go`'s tokenizer is a hand port with a small table-driven test.** §1.1. Not
because it is D11's peer — 33 lines against 338 — but because it is the console's entire input path
and has three interacting rules (single **and** double quoting, backslash escapes that are only
honoured inside quotes, and an unterminated-quote error) whose interaction is exactly the shape
`AGENTS.md`'s bar names. Note the one behaviour that reads as a bug and is not: a backslash inside
quotes drops the backslash and keeps the next character *whatever it is* (`console.ts:28-30`) — there
is no escape table, unlike `literal.ts`'s. Port it as written.

**C13 — both `errors.go` ports are re-derived against real failures in the Go acceptance suite, never
guessed, and both keep the driver's own message verbatim (Adapter rule 4).** Mongo: an
`AbortError`-equivalent (`context.Canceled`, checked **first**, as `errors.ts:11-13` checks its own
first) → `E_CANCELLED`; server-selection and network errors → `E_CONNECT`; a command error with code
**18** (AuthenticationFailed) or **13** (Unauthorized) → `E_AUTH`; everything else → `E_QUERY`.
Redis: `context.Canceled` → `E_CANCELLED`; `redis.Nil` handled at the call site, never mapped;
a RESP error whose text starts `NOAUTH`/`WRONGPASS`/`NOPERM` or matches `invalid password` →
`E_AUTH`; `*net.OpError`/`*net.DNSError`/`os.ErrDeadlineExceeded` → `E_CONNECT` (the Go re-derivation
of `errors.ts:14-16`'s three Node errnos, exactly as `postgres/errors.go` and
`mysqlfamily/errors.go` already did); everything else → `E_QUERY`. The two "connection is closed" /
"stream isn't writeable" string tests (`errors.ts:23-25`) are **ioredis message texts** and have no
Go subject — delete them, do not port them, and let the `net` error branch cover the real case.

**C14 — `adapterhost.TestKindNodeServed` moves from `"mongodb"` to `"kafka"` in M7.1, before either
flip, and its doc comment names P58e as the next mover.** §1.8. `kafka` is the last of the eleven to
go native (P58 §9's M9), so this is the final move before P58f retires the constant. Five consuming
files need no edit — which is the whole dividend of P58b B16, and worth saying out loud so nobody
"improves" the constant back into literals.

**C15 — `tests/e2e-real/mariadb-real.spec.ts`'s Node-served side moves from MongoDB to Kafka in
M7.1, in the same commit as C14.** §1.9. `tests/e2e-real/support/mongo.ts` is replaced by an
identically-shaped `support/kafka.ts`. The spec's first test (MariaDB, native, end to end) is
untouched. Its second test — **checkpoint C1b** — keeps its exact shape: connect a second, still
Node-served connection, render a page from it through the *index-keyed* chunk encoding (which is
also the live proof that `toTypedArray`'s second branch is still needed, P58a A9/A10), `SIGKILL` the
Node engine child, and assert that one flips to `error` while MariaDB stays `connected` and still
serves a read after a `page.reload()`. RabbitMQ is the named fallback if the Kafka native addon
proves troublesome inside the `-tags server` binary; OQ-3.

**C16 — `Router.childrenNative` normalizes a nil `TreeChildren.Nodes` to an empty slice, and both
new adapters additionally return `[]model.TreeNode{}` explicitly at every leaf.** Belt and braces,
for a hazard that is *specific to these two adapters* in a way it was not for the SQL four.
`describeNative`/`definitionNative` got this treatment at P58b's own closeout, for exactly the same
root cause: Go's `encoding/json` marshals a nil slice as `null`, and every native adapter builds its
list fields the idiomatic Go way. `childrenNative` (`router.go:240-259`) never did. Why it matters
here and did not there: **Adapter rule 5 is "Children() returns an empty slice for a leaf, never an
error", and both of these adapters have leaf levels the SQL adapters reach far less often** —
mongo's `children()` returns `{nodes: []}` for every collection (`index.ts:89-94`), redis's for
every key node (`index.ts:75`), and `redis.spec.ts` 5 and `mongo.spec.ts` 5 both assert
`expect(children).toEqual([])` literally. The renderer's consequence is concrete rather than
theoretical: `project/state/tree.ts:108` assigns `result.nodes` straight into `treeState.children[k]`,
`:153`'s `if (treeState.children[k]) return;` treats `null` as "not loaded" and re-fetches on every
expand, and `filterTree.ts:46`/`:178` iterate `Object.entries(treeState.children)` and would call a
method on `null`. **A Go test asserting `len(nodes) == 0` passes for a nil slice**, which is why the
adapter-level fix alone is insufficient and the router-level one alone is easy to forget — hence
both, plus a `data_test.go`-style assertion that the marshalled JSON contains `"nodes":[]` and not
`"nodes":null`.

**C17 — both packages keep one Go file per TypeScript file.** P58 D18, P58a A20, P58b B19, applied.
`index.ts` → `adapter.go`; everything else keeps its name. `mongo/`: `adapter.go`, `caps.go`,
`catalog.go`, `client.go`, `console.go`, `definition.go`, `errors.go`, `literal.go`, `mutate.go`,
`read.go`. `redis/`: `adapter.go`, `caps.go`, `catalog.go`, `client.go`, `console.go`, `errors.go`,
`mutate.go`, `read.go` — eight files, no `definition.go`, because `redisCaps.definition` is
permanently `false` (P23 D10) and `definition()` is a two-line `Unsupported`. The point is
diffability: when a Go behaviour disagrees with the TypeScript, `redis/read.go` and `redis/read.ts`
are the two files to put side by side.

**C18 — the two caps literals port value for value, and nothing changes.** `mongoCaps`'s 21 fields
and `redisCaps`'s 21, verbatim. Explicitly, because each looks like an error to a reader who has not
read its comment: `redisCaps.cancel` stays **`true`** even though `Cancel()` returns `false` (C9,
§1.7); `redisCaps.exactCount` stays **`true`** and describes a *per-key* O(1) type-length count,
which `caps.ts:24-26` distinguishes from §5.1's "DBSIZE only" wording about a db-wide count the
adapter never surfaces; `redisCaps.describe`/`definition` stay **`false`** and are two unrelated
flags that merely coincide (P31 F5, `caps.ts:19-21`); `mongoCaps.exactCount` stays **`false`**
because the default count is `estimatedDocumentCount` (P8 D5); `mongoCaps.sql` stays **`true`** for
both, which means "has a console", not "speaks SQL". P58c is not the phase that revisits any of
these.

**C19 — `nativeKinds` grows in two separate commits, never one.** `{"mongodb"}` at the end of M7.3,
`{"redis"}` at the end of M7.4. Each commit's message records which acceptance suite went green
immediately before it, and each is followed by the full `tests/e2e-real/` sweep §5.6 requires.

**C20 — `tests/db/{mongo,redis}.spec.ts` are deleted in the commit *after* their Go successors are
green**, per adapter, per P58 D12's third rule and P58a A21's discipline — **and** M7.4's closeout
records in `AGENTS.md` whether P58b's own four deletions (§1.10) are still outstanding. This plan
does not delete another sub-phase's specs on its own initiative; OQ-1 asks whether it should.

**C21 — `tests/db/support/{mongo,redis}.ts` are kept, their consumers are named, and the grep is
re-run at implementation time.** §1.10. The Go seeders **cannot** read the same file the way P58a's
and P58b's did, because `0003_mongo_seed.ts` and `0004_redis_seed.ts` are TypeScript functions rather
than `.sql` — so §4.5 turns their thirteen exported constants and every seeded shape into an explicit
checklist. That is a real weakening of P58 D12's *"byte-identical dataset"* property and it is named
as one, not glossed: the Go fixture must be re-derived and then **cross-checked** against a live
TypeScript-seeded container once (§6, RD-1(a)/MG-1's own containers make this nearly free).

**C22 — P58c's `src/` diff is empty, and §5.2 asserts the strong form.** `git diff --stat src/`
returns nothing at all, no exclusions — the same form P58b B21 asserted and met, and it holds for the
same reason: `toTypedArray`'s base64 branch already exists in the tree, verified at `223cf02`. If it
is ever non-empty, either P58 D1 was broken or the substrate has a coupling no plan in this phase has
found, and the implementer stops and says so rather than absorbing it.

**C23 — every mutating redis test runs against db index 1.** §1.12. Never db0 (whose exact root
listing scenario 3 asserts), never a new index (which would appear in scenario 3's own database
list).

**C24 — every mutating or slow-operation mongo test creates its own collection.** §1.12.
`mutate_probe`, `literal_probe` and `slow_probe`, created from the root client for that one test,
exactly as the TypeScript spec does — never `widgets`, `big_widgets`, `oversized_widgets`,
`validated_widgets` or `empty_collection`, all of which other scenarios assert against by exact
content.

**C25 — `shell/go.mod` gains exactly two runtime modules and two test-only ones.**
`go.mongodb.org/mongo-driver/v2` and `github.com/redis/go-redis/v9`; plus
`github.com/testcontainers/testcontainers-go/modules/mongodb` and `.../modules/redis`, both at
**v0.44.0** to match the pinned core. No BSON library other than the driver's own `bson` package, no
JSON5 parser, no expression evaluator (P58 D11), and no second Redis client.

## 3. Target tree

```
shell/internal/adapters/
  testsupport/
    spec.go                     EDITED M7.1  + DocIDAt/DocBodyAt/KVPairs/KVValueAt — the
                                             DocumentPage/KeyValuePage readers spec.go has only
                                             a TabularPage CellAt for today (§1.3 gap 3)
    mongo.go                    NEW    M7.3  mongo:7, the double-"Waiting for connections" wait,
                                             the root user, the unprivileged `kira` user scoped to
                                             kira_test + kira_analytics, 0003_mongo_seed.ts's own
                                             shapes re-expressed in Go (C21, §4.5)
    redis.go                    NEW    M7.4  redis:7 with a password, db0 seeded from
                                             0004_redis_seed.ts's shapes, db1 seeded with its one
                                             marker key (C23's own target db)
  mongo/                        NEW    M7.2-M7.3  (C17) 10 files, one per mongo/*.ts:
    literal.go                  NEW    M7.2  P58 D11 — written first, alone, with no driver
    literal_test.go             NEW    M7.2  the table-driven oracle, written before literal.go
    adapter.go   caps.go   catalog.go   client.go   console.go
    definition.go errors.go  mutate.go    read.go
    mongo_test.go, main_test.go NEW    M7.3
  redis/                        NEW    M7.4  (C17) 8 files, one per redis/*.ts — no definition.go:
    adapter.go   caps.go   catalog.go   client.go
    console.go   errors.go  mutate.go    read.go
    console_test.go             NEW    the tokenizer's table-driven test (C12)
    redis_test.go, main_test.go NEW

shell/internal/adapterhost/router.go        EDITED  M7.1  TestKindNodeServed -> "kafka" (C14);
                                                    childrenNative normalizes Nodes (C16)
                                            EDITED  M7.3/M7.4  nativeKinds += mongodb, then redis,
                                                    in two separate commits (C19)
shell/internal/adapterhost/router_test.go   EDITED  M7.1  the nil-Nodes assertion; fakeKind untouched
shell/main.go                               EDITED  two blank imports (mongo, redis), one per
                                                    milestone — §4.6's most-forgotten step
shell/go.mod / go.sum                       EDITED  + mongo-driver/v2, go-redis/v9;
                                                    + testcontainers modules mongodb/redis (test-only)

shell/internal/{page,enginecache,enginebackend}/**  UNCHANGED  §1.3 — deliberately, not by omission
shell/internal/adapters/{sqltext,sqlmutate,abort,caps,errors,registry,live,adapter}.go  UNCHANGED
shell/internal/{oplog,enginehost,storage,tree,connections,bridge,shell}/**  UNCHANGED
src/**                                              UNCHANGED  C22 — every file, including port.ts

tests/e2e-real/mariadb-real.spec.ts         EDITED  M7.1  the coexistence half's Node-served side
                                                    moves MongoDB -> Kafka (C15)
tests/e2e-real/support/mongo.ts             DELETED M7.1  its only consumer is the line above
tests/e2e-real/support/kafka.ts             NEW     M7.1  a two-line re-export of
                                                    tests/db/support/kafka.ts, mirroring the shape
                                                    support/mongo.ts had
tests/db/mongo.spec.ts                      DELETED M7.3 last commit (C20)
tests/db/redis.spec.ts                      DELETED M7.4 last commit (C20)
tests/db/support/{mongo,redis}.ts           UNCHANGED  real consumers elsewhere (§1.10, C21)
tests/db/fixtures/{0003,0004}_*.ts          UNCHANGED  still read by those support modules
tests/ipc/**                                UNCHANGED  §1.11 — the generator port is P58f's
tests/ui/**                                 UNCHANGED  P58a A10
package.json                                UNCHANGED  test:db runs a directory (P58b §5.1)

docs/ARCHITECTURE.md                        EDITED  per-database mapping (the Redis Cancel cell's
                                                    stale CLIENT KILL claim, §1.7; and SQLite's,
                                                    left over from P58b — OQ-2), the MongoDB/Redis
                                                    per-engine section, the Stack driver line
docs/v1/plans/P58c-mongo-redis.md           EDITED  §12 M7.0 results, then §13 M7.1-M7.4 results
AGENTS.md                                   EDITED  the P58c findings entry
```

## 4. Designs

### 4.1 `mongo/literal.go` — M7.2's whole milestone

`literal.ts`'s five parts, translated. Everything below is behaviour that must be preserved, not
restated structure.

**The tokenizer** (`tokenize`, `literal.ts:29-96`). Seven states in one loop over runes — and it
must be **runes, not bytes**: `literal.ts` indexes a JS string by UTF-16 code unit and its
`/[A-Za-z_$]/` and `/\s/` tests are Unicode-aware, so a Go port iterating `[]byte` would split a
multi-byte character inside a quoted string. Use `[]rune` and keep `pos` as the **rune index**, since
`pos` reaches the user in five error messages and a byte offset would name a different position than
the TypeScript did.

| Rule | Detail that must survive |
|---|---|
| whitespace | skipped, no token |
| `//` line comment | to `\n` or EOF |
| `/* */` block comment | `i += 2` past the terminator, **including when unterminated** — `literal.ts:46` walks off the end and the loop then exits; do not "fix" this into an error, it is the difference between a trailing `/*` being ignored and being rejected |
| punctuation | the exact set `{}[]:,().` — note `.` and `(` `)`, which exist only for `console.ts`'s `db.<coll>.<method>(…)` grammar, not for JSON |
| strings | single **or** double quoted; the nine-entry escape table (`n t r b f \ " ' /`); `\uXXXX` consuming exactly six characters; **an unknown escape yields the escaped character itself** (`ESCAPES[esc] ?? esc`); an unterminated string is `E_QUERY "unterminated string literal"` |
| numbers | `[0-9]` or `-` followed by `[0-9]`; then greedily `[0-9.eE+-]`. This accepts garbage like `1.2.3e+-4` and defers rejection to `Number()`/`strconv` — port the same shape, and see below |
| identifiers | `[A-Za-z_$]` then `[A-Za-z0-9_$]*` |
| anything else | `E_QUERY 'unexpected character "x" at position N'`, where the character is **JSON-quoted** (`JSON.stringify(c)`) |

The number rule has one Go-specific wrinkle worth pre-deciding: `Number("1.2.3")` is `NaN` in JS and
the TypeScript happily produces a `NaN` value, which BSON encodes as a double NaN. Go's
`strconv.ParseFloat` returns an error. **Return `E_QUERY "invalid number \"1.2.3\" at position N"`**
rather than silently substituting NaN — this is a deliberate, narrow improvement, it is the only
place C4's "byte-identical messages" rule gains a message the TypeScript never had, and it gets a
test case and a line in `AGENTS.md`'s findings.

**The parser.** `ParseValue` dispatch order matters and is asserted by the console: `{` → object,
`[` → array, string, number, then identifier — where `true`/`false`/`null`/`undefined` are handled
**before** the constructor table, `undefined` maps to **`null`** (not to a Go `nil` interface with a
different meaning), and an identifier that is neither a literal nor a constructor **followed by
`(`** is `E_QUERY 'unrecognized identifier "x" at position N'`. Note the lookahead:
`this.tokens[this.pos + 1]?.value === '('` (`literal.ts:177`) — a bare `ObjectId` with no call
parentheses is *not* a constructor and falls through to the same rejection, which is what makes
"no bare-word values" (`literal.ts:98`) true.

Objects and arrays both allow **one trailing comma** and both terminate on it
(`literal.ts:210-220`, `:233-243`). Object keys may be a string **or** a bare identifier
(`parseKey`) — but not a number, which is why `{ 1: "x" }` is `E_QUERY "expected an object key at
position N"`.

**The value representation.** C2's order requirement applies to parsed values too: an object becomes
`bson.D`, not `bson.M`, all the way down, because a parsed filter's key order is visible in
`op.SetCommand`'s `db.<coll>.find({…})` text and in the mutation preview. An array becomes
`bson.A`. A string stays a `string`, a number a `float64` (C5), a boolean a `bool`, null a `nil`
interface value.

**The constructor table**, six entries, closed:

| Shell form | TS | Go |
|---|---|---|
| `ObjectId(hex?)` | `new ObjectId(arg === undefined ? undefined : String(arg))` — no arg means a **fresh** id | `bson.NewObjectID()` when the arg is absent, `bson.ObjectIDFromHex` otherwise |
| `ISODate(s)` | `new Date(String(arg))` | `time.Parse` over the layouts a JS `Date` constructor accepts — RFC3339 first, then the two shorter forms the fixture uses; an unparseable value must produce the TS's own behaviour (an *Invalid Date*, which BSON-encodes as a date with NaN ms) — **decide and test this explicitly**, do not let it default |
| `Date(s?)` | no arg → **now** | `time.Now().UTC()` |
| `NumberLong(s)` | `Long.fromString(String(arg))` | `int64` via `strconv.ParseInt` |
| `NumberInt(s)` | `Number(arg)` — a **plain JS number**, so the driver decides the stored width | `int32`; §1.4's fidelity note and `mongo.spec.ts` 24's own comment both bear on this, and the spec deliberately asserts only the *value*, not the width |
| `NumberDecimal(s)` | `Decimal128.fromString` | `bson.ParseDecimal128` |

**`ResolveEJSONWrappers`.** The three-part rule ports exactly: an already-resolved BSON instance
(`ObjectID`, `time.Time`, `int64` from `NumberLong`, `Decimal128`) passes through untouched
(`isResolvedBsonInstance`, `literal.ts:285-292`, and its comment says why — walking a resolved
instance's own fields would be wrong); a plain object with **any** key in the thirteen-entry wrapper
set is handed to the BSON extended-JSON decoder with a swallow-and-fall-through `catch` (C4); every
other object is walked recursively. The thirteen keys, verbatim: `$oid $date $numberInt $numberLong
$numberDouble $numberDecimal $binary $timestamp $regularExpression $code $ref $minKey $maxKey`.

**Three exported entry points**, matching `literal.ts`'s own: `ParseJSON5Literal(text) (any, error)`
(rejecting trailing content), `ParseDocumentLiteral(text) (bson.D, error)` with the message
`"document must be a JSON object"`, and `ParseFilterObject(text *string) (bson.D, error)` with the
message `"filter must be a JSON object literal, e.g. { field: \"value\" }"` and its nil/blank →
empty-document short-circuit. Plus the `LiteralParser` type itself, whose
`ExpectIdent`/`ExpectPunct`/`PeekPunct`/`ParseValue`/`AtEnd` surface `console.go` drives.

### 4.2 `mongo`, file by file

`go.mongodb.org/mongo-driver/v2`, one pooled `*mongo.Client` (C7).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | URI mode passes `cfg.URI` through untouched (*"the URI is driver-ready as-is"*, `client.ts:22-24`); fields mode builds `mongodb://[user[:pass]@]host:port/[db]` with **percent-encoded** user and password (`client.ts:62-70`); `connectTimeoutMS`/`serverSelectionTimeoutMS` both 10 000; `driverInfo: {name: "kira-studio"}` → `options.Client().SetAppName`-equivalent driver-info field; the `sslmode` map (`require`/`prefer` → TLS with certificate verification **off**, `verify-full` → TLS verifying, `disable`/absent → no TLS, anything else → a warn-and-ignore log line). `defaultDatabase` is the console's fallback target and is parsed from the URI in URI mode, taken from `cfg.Database` otherwise |
| `adapter.go` | `index.ts` | The `Adapter` impl; `connect` runs `admin().buildInfo()` and closes the client on failure **before** assigning the handle (P13 D1); `serverVersion` is `"MongoDB <version>"` with `"unknown"` as the fallback; the four path-shape validators, each with its own message verbatim; `describe`'s deliberate stub (columns `[]`, `primaryKey` nil, FKs `[]`, `referencedBy` `[]`, indexes from `describeIndexes` with `primary: name == "_id_"`); `Cancel` per C6/§4.4 |
| `catalog.go` | `catalog.ts` | `listDatabases` with `nameOnly: true` minus the three system databases (`admin`, `local`, `config`); `listCollections` with `nameOnly: true`, `hasChildren: false` (P19 D5 — a collection is a leaf), `detail: "view"` for a view, sorted by name; `collectionOptions` (the definition view's own lookup, **not** `nameOnly`, and deliberately never called from the tree); `describeIndexes`. Every one of these returns `[]model.TreeNode{}` explicitly when empty (C16) |
| `read.go` | `read.ts` | The densest file after `literal.go`. `IDText` (C3); the free-text-sort refusal; the `idOnlySort` predicate (no sort terms, **or** exactly one term on `_id`); the keyset-unavailable refusal with its message verbatim; `RequestFingerprint` over `{path, filter, sort, pageSize}` **in that field order**; `reverseRows`/`mongoDirection`/`scanDirection`'s three-way derivation and the `$gt`/`$lt` operator that *"tracks the scan's own direction, not which user-facing request caused it"* (`read.ts:67-71` — the comment ports with the code); the `+1` probe; the projection document built from `req.Projection` **without ever adding `_id: 0`** (`read.ts:81-85`'s five-line reason); P43 iter2 D24's `skip` rule — **any** offset cursor with a non-zero offset applies `skip`, not only a non-`_id` sort, and `> 0` keeps an ordinary first page issuing none; `op.SetCommand("db.<coll>.find(<ejson filter>)")` **before** the query (Adapter rule 3); the four-way `hasForward`/`hasBackward` token rules. `CountRows`: `estimatedDocumentCount` by default, `countDocuments` whenever the filter is non-empty (P8 D5). Note the `opts.exact` parameter (`read.ts:161`) has **no caller** — `data.ts` never passes it — so the Go signature drops it rather than porting a dead knob |
| `console.go` | `console.ts` | `parseStatement` over `LiteralParser` (`db` `.` ident `.` ident `(` args `)`), the ten-method closed set read from the same shared list the renderer's completion source reads (P18 addendum D21 — in Go that is `model`/a small shared constant, **not** a second literal copy); `asDoc`/`asDocArray` with their per-argument labels; `docsToPage`/`statusPage` over `NewDocumentPageBuilder`; **one** `op.SetCommand(strings.Join(statements, ";\n"))` for the whole batch (P5.5 D9), `CheckCancelled` between statements, one page per statement |
| `mutate.go` | `mutate.ts` | The `$document` sentinel (D3) and its three rendered forms verbatim (`db.<c>.replaceOne({_id: ...}, <doc>)`, `db.<c>.deleteOne({_id: ...})`, `db.<c>.insertOne(<doc>)`); `parseIdKey`'s exactly-`{_id}` rule and its `"malformed _id in mutation key"` catch-all; `Preview` synchronous with no network and no catalog; the replace path's `{...parsed, _id: id}` merge and its `matchedCount != 1` guard, message verbatim; the delete path's `deletedCount != 1` guard, message verbatim; the insert path's acknowledged check; `assertWritable` first (§8.12) |
| `definition.go` | `definition.ts` | `collectionOptions`, the `hasOptions` test, **relaxed** 2-space-indented extended JSON via `json.Indent` (§1.4's fourth point), `buildDocumentSchema`'s three-way split ($jsonSchema → a field table, any other validator → read-only JSON, none → the `NO_OPTIONS_NOTE` string verbatim), `generatedAt` as `time.Now().UTC().Format(time.RFC3339Nano)` matching the other four adapters |
| `errors.go` | `errors.ts` | C13 |
| `caps.go` | `caps.ts` | C18's literal |

### 4.3 `redis`, file by file

`github.com/redis/go-redis/v9`, `Protocol: 2` (C10), a `DbConnectionSet` of at most 8 clients (C8).

| Go file | Ports | Key points |
|---|---|---|
| `client.go` | `client.ts` | `resolveFields` (URI or fields; host/port defaults `localhost`/6379; the `sslmode` map — `require`/`prefer`/`verify-full` all just turn TLS on, anything else warn-and-ignore; the `database` field parsed as a **db index**, defaulting to 0 on anything non-integral or negative); `DbConnectionSet` with `Get(dbIndex)`, `Primary()`, `CloseAll()`, the insertion-order LRU list and an eviction that **never evicts the primary** (`client.ts:141-149`); `ClientName: "kira-studio"`; a 10 s dial timeout. ioredis's two error-listener workarounds are deleted, not ported (C8) |
| `adapter.go` | `index.ts` | The `Adapter` impl; `connect` runs `INFO server` on the primary and regexes `redis_version:` out of it, closing everything on failure; `details: {database: "db<n>"}`; `describe`/`definition` are `Unsupported`; `resolveKeyTarget` (a `database` root plus a trailing `key` segment, any number of `namespace` segments between); `mutate`'s path resolves only to a database, never to a key, because the ops carry their own `_key`; `Cancel` is the permanent `false` with its nine-line comment (C9) |
| `catalog.go` | `catalog.ts` | `listDatabases` parses `INFO keyspace`'s `db<N>:keys=<M>` lines, sorts **numerically** (`localeCompare(..., {numeric: true})` → a numeric comparison on the parsed index, not a string sort — `db10` must not sort before `db2`), sets `hasChildren: false` (P41 D5) and a `detail` using the same K/M/B/T abbreviation the SQL adapters use for row estimates; `dbIndexFromName` with its `E_NOT_FOUND` message; `listNamespaceChildren` — the `:`-splitting SCAN walk with `SCAN_COUNT = 1000`, `MAX_SCAN_ROUNDS = 200`, `CheckCancelled` per round, namespace nodes deduped by segment and key nodes carrying the **complete literal key** as their name (D3), both sorted by name, namespaces before keys; and P43 iter2 F16/D21's `truncated` rule — **true only when `cursor != "0" && rounds >= MAX_SCAN_ROUNDS`**, never for an ordinary complete scan. This is the only `Truncated` producer in the whole app (§1.1) |
| `read.go` | `read.ts` | Six type dispatches (§1.2). `readMeta` per C11. `readString` → an unpaged one-row page, and **nothing pushed at all** when `GET` returns nil. `readScanFamily` — the shared hash/set/zset loop: `before` is `E_UNSUPPORTED` ("forward-only; there is no previous page"), an `after` cursor decodes to a SCAN cursor string, a bare/`offset` cursor **silently restarts from `"0"`** (redis 24's contract, on which `views/keyvalue/state.ts`'s D40 depends — port it and its comment verbatim, and do **not** turn it into an error), whole rounds are accumulated without slicing (§1.11's overshoot rule), a set pushes `strconv.Itoa(rowCount)` as the field name and a hash/zset pushes the real pair. `readList` — offset-only, `LRANGE offset..offset+pageSize-1` honouring the requested page size in full (P43 iter2 D25/F18 — the deleted `LIST_WINDOW` clamp must not come back), `LLEN` for `hasMore`, field names are the absolute indices. `readStream` — `XRANGE key <start> + COUNT pageSize+1`, `before` refused, an `after` cursor becoming the **exclusive** `(<id>` lower bound, fields flattened to a JSON object per entry. `CountKey` — the six O(1) type-length commands, `TYPE` first, `none` → `E_QUERY "key no longer exists: <key>"` |
| `console.go` | `console.ts` | C12's tokenizer; `client.Do(ctx, args...)` for generic dispatch; `formatReplyItem`'s branches (C10); `resultToPage`'s array-vs-scalar split, where a scalar's field name is the **upper-cased command** and an array's are the indices; one `op.SetCommand` for the whole batch; blank lines filtered out before the empty-batch `E_QUERY` |
| `mutate.go` | `mutate.ts` | The `_key`/`$value` sentinels and their three rendered forms verbatim (`SET k v`, `DEL k`, `SET k v NX`); `assertEditableType`'s TYPE check — note its rule allows a **nonexistent** key (`rawType != "none" && rawType != "string"` is the rejection), which is what makes insert work; `assertWritable` first; `CheckCancelled` per op; the `NX` insert's `"key already exists: <key>"` on a non-`OK` reply — in go-redis a failed `SET … NX` returns `redis.Nil`, **not** a non-OK string, so this branch is re-derived rather than translated, and gets its own test |
| `errors.go` | `errors.ts` | C13 |
| `caps.go` | `caps.ts` | C18's literal, comments included |

### 4.4 Cancellation, pagination and error mapping — the table P58 §4.7 requires

| | mongodb | redis |
|---|---|---|
| **Cancel mechanism** | `$currentOp: {allUsers: false, idleConnections: false}` on `admin`, `$match` on `command.comment == opId`, then `{killOp: 1, op: <opid>}` per hit — `opid` round-tripped as an opaque value, never assumed numeric. Needs no privilege beyond the connection's own (§1.6) | **None, deliberately.** `Cancel(opID)` returns `false` permanently (P9 D7/D8). `adapterhost.Host.CancelOp`'s first step — cancelling the op context — is the whole mechanism, and `CheckCancelled` between SCAN rounds is where it lands |
| **Driver ctx** | never the op's — `RunWithAbortRace` on a detached context (C6); otherwise the driver's own abort beats `killOp` to the operation and `Cancel` reports `false` | never the op's — `RunWithAbortRace` on a detached context (C9); the alternative (passing it through) is named, costed and not taken |
| **`caps.cancel`** | `true`, unchanged | `true`, unchanged — and honest, despite `Cancel()` returning `false` (§1.7, C18) |
| **Pagination** | `pagination: "cursor"`. `_id`-keyset when the request is unsorted or sorted purely by `_id`; `skip`/`limit` for any other sort; the `PagePosition.strategy` field reports `"keyset"` or `"offset"` accordingly, *not* `"cursor"`. Token = `EncodePageToken([IDText(lastDoc)], fingerprint)`, unpadded base64url over the `{v,k,f}` payload | `pagination: "cursor"`, and **four different position shapes** in one adapter: `string` → `UnpagedPosition(1)`; hash/set/zset → `strategy: "cursor"`, forward-only, `nextToken` = the SCAN cursor, `prevToken` always nil; `list` → `strategy: "offset"` with a real `offset`; `stream` → `strategy: "cursor"` with the last entry id. An `offset` cursor on a cursor-paged key restarts the scan rather than seeking (redis 24) |
| **Error mapping** | ctx first → `E_CANCELLED`; server-selection/network → `E_CONNECT`; command code 18/13 → `E_AUTH`; else `E_QUERY` | ctx first → `E_CANCELLED`; RESP text prefixed `NOAUTH`/`WRONGPASS`/`NOPERM` (or matching `invalid password`) → `E_AUTH`; `*net.OpError`/`*net.DNSError`/deadline → `E_CONNECT`; else `E_QUERY`. ioredis's two message-text tests are deleted (C13) |

### 4.5 `testsupport`: two new fixtures, and the seed files that cannot be reused

Both plug into `fixture[T]` (P58b B15) with an exported `StopX()` called from the package's own
`TestMain` after `m.Run()` — never `t.Cleanup`, for the reason `fixture.go`'s package doc gives.
`mongo.go` keeps the `IsDockerAvailable` gate; `redis.go` does too.

**C21's cost, made concrete.** P58a and P58b's Go seeders read `tests/db/fixtures/*.sql`
**unchanged**, which is what made P58 D12's *"byte-identical dataset"* guarantee literal.
`0003_mongo_seed.ts` and `0004_redis_seed.ts` are TypeScript **functions**, so the Go seeders must
re-express them. The checklist, so it is a table rather than a memory:

| Fixture | Container | Every shape the Go seeder must reproduce |
|---|---|---|
| `mongo.go` | `mongo:7`, `MONGO_INITDB_ROOT_USERNAME`/`PASSWORD` = `root`/`kira`, the **double** `Waiting for connections` wait (§1.13) | An unprivileged `kira`/`kira` user with `readWrite` on **both** `kira_test` and `kira_analytics` (the tree-enumeration test sees two non-system databases only because `listDatabases` filters by authorization); `widgets` — 25 documents with **fixed hex `_id`s** `000000000000000000000<000..018>` (deterministic keyset assertions depend on this), `name: widget-<i>`, `price: (i+1)*1.5` (a BSON **double**, §1.4), `active: i%2==0`, `createdAt: UTC(2024,0,i+1)`, `tags` alternating `['red','small']`/`['blue']` on `i%3`, `meta: {weight: i, note: null on i%5==0}`; a **unique** index on `{name: 1}`; `empty_collection` with an `_id` index; `oversized_widgets` with one 100 000-character `note` (past `DocumentTruncateBytes`, P27 D22); `big_widgets` — 1 200 documents with `_id`s `0000000000000000000<00000..004AF>`, `seq`, `label`; `validated_widgets` created with a real `$jsonSchema`, `validationLevel: "moderate"`, `validationAction: "warn"`; and `kira_analytics.events` with two documents |
| `redis.go` | `redis:7` with password `kira` (the auth-failure test needs one) | **db0**: `counter=42` (a root key with no `:`, which namespace splitting must surface as a leaf); `session:abc` with a 10 000 s TTL; `user:1:name`, `user:1:email`, `user:2:name`; `user:1:profile` = `{age:30, city:NYC}`; `user:1:bighash` = **5 000** fields `f<i>`/`v<i>` (past `hash-max-listpack-entries` = 128, so HSCAN genuinely pages — P43 iter3 D40/F37); `queue:jobs` = 30 `job-<i>`; `queue:big-jobs` = **1 200** `big-job-<i>` (past the deleted `LIST_WINDOW` clamp of 500); `tags:featured` = {red, green, blue}; `leaderboard` = {alice:10, bob:20, carol:30}; `events:log` = 5 `XADD`ed entries with `type=click`, `seq=<i>`. **db1**: `other-db:marker` (so `INFO keyspace` reports two databases) — and C23's own target for every mutating test |

**The cross-check that buys back most of what C21 costs**, and it is nearly free because M7.0
already has both containers up: once, in M7.0, start the TypeScript fixture and the Go fixture side
by side and diff the two keyspaces / the two collections' document counts and `_id` sets. Recorded
in §12 as a probe result, not repeated per run.

### 4.6 The router flip, and what else it touches

`nativeKinds` is the whole mechanism (P58 §4.6). Enumerated so the implementer checks each rather
than trusting "the router handles it":

- **Control plane** — `connections.{Test,Connect,Disconnect,Remove}` and
  `tree.{Children,Describe,Definition}` start reaching `adapterhost.Host` for that kind. Nothing to
  write; C14's single-constant move is the only fallout, because P58b B16 already absorbed it.
- **Data plane** — that kind's pages start arriving base64-encoded and `toTypedArray`'s first branch
  handles them. No change. **But this is the first flip after which a `DocumentPage` and a
  `KeyValuePage` cross the wire from Go**, so it is the first flip whose *page kind* is new to the
  native path — §5.6's full-suite sweep is not optional here.
- **Cancel** — routes on op ownership, not kind (P58a A13). A flip changes nothing.
- **`connections.MarkAllErrored`** — P58a A15 narrowed it to Node-served kinds. After M7.4, seven of
  eleven kinds are excluded. Checkpoint C1c step 12 is the check that this is still right.
- **`cache:stats`** — P58a A16's merge is unchanged.
- **The Browse tab** — new to the native path with redis (§1.1). `views/browse/state.ts` is the only
  consumer of `TreeChildren.Truncated`, and `redis/catalog.go` is its only producer.
- **`shell/main.go`** — one blank import per new adapter package. **The single most likely thing to
  be forgotten**, because omitting it produces no compile error: `CreateAdapter` returns
  `E_UNSUPPORTED "<kind> connections are not supported yet"` at connect time, in the real app only,
  and never in `go test ./internal/adapters/<engine>` (which constructs the adapter directly). §8
  makes it a per-milestone acceptance check, exactly as P58b §4.6 did.
- **`adapterhost.TestKindNodeServed` and `mariadb-real.spec.ts`** — C14 and C15, already landed in
  M7.1 by the time either flip happens. §8's M7.1 criterion is what proves it.

## 5. Testing plan

### 5.1 What survives untouched

- **`tests/ui/`** entirely — 36 tests, 18 spec files, both wire planes mocked. P58a A10 holds: the
  mocked tier still speaks the index-keyed chunk encoding, which `toTypedArray`'s second branch still
  decodes. `tests/ui/support/{mongoFixture,redisFixture}.ts` are captured mock data and describe the
  *renderer's* contract, not the adapter's; they do not change.
- **`tests/ipc/`** entirely — all three halves of all seven adapters, redis included. §1.11 records
  the cost of that being true.
- **`tests/unit/`** entirely. Nothing in P58c has a TypeScript unit-test subject that moves.
- **`package.json`.** `test:db` runs a directory (`scripts/run-db-tests.sh`'s
  `bun test tests/db --path-ignore-patterns '**/kafka.spec.ts'`), so deleting two spec files needs no
  script edit.
- **`scripts/capture-tree.ts`** — it imports both support modules and both stay (C21).

### 5.2 The `src/` non-change, asserted in its strong form

Every milestone from M7.1 onward ends with `git diff --stat src/` returning **empty** — no exclusion
(C22). If it is ever non-empty the implementer stops and says so rather than absorbing it.

### 5.3 The MongoDB Go tier

`shell/internal/adapters/mongo/mongo_test.go`, driven by `testcontainers-go` against `mongo:7`,
seeded per §4.5. §1.12's table is the scope: 21 scenarios port as-is, 2 are re-baselined against the
driver's own wording, 2 collapse, 1 is renamed.

Four cases carry more weight than the rest:

| Test | Why |
|---|---|
| **`_id` text round-trips through the parser** (new, C3) | For **every** document in `widgets` (ObjectId `_id`s) and `mutate_probe` (integer `_id`s): `ParseFilterObject(IDText(doc))`-as-a-filter must match exactly that one document. This is the structural version of §1.5's four-way closure requirement, and it is the one test that would catch a `MarshalExtJSON`/`literal.go` disagreement before a user hits it through *Copy `_id`* |
| **EJSON rendering is byte-stable across every fixture type** (new, C2) | The document body text for a `widgets` document must contain the exact wrappers for its ObjectId, its Date, its double `price`, its array `tags` and its nested `meta` — asserted as literal strings, not by re-parsing. Plus one `<`-bearing document proving `escapeHTML` is off. MG-1 produces the expected strings; this test pins them |
| **cancel, asserted server-side via `killOp`** (spec 22, ported, **must not be softened**) | A slow operation is started through `RunOp`; the test polls `{currentOp: 1, 'command.comment': opId}` **through a separate root client** until it appears; `CancelOp` is called; `Cancel` returns **`true`**; the op rejects with `E_QUERY` (the server killed it — *not* `E_CANCELLED`, which would mean the local abort won, and `mongo.spec.ts:807-809`'s comment says exactly that); and the poll is repeated until it is **gone**, with a bounded deadline. The second poll is the assertion. **The predicate is a tracked op id, never a text pattern over the command** — `AGENTS.md`'s P58b M6.4 self-match finding, applied before it can recur |
| **field order survives a read** (new, C2) | A `widgets` document's rendered body has its keys in insertion order (`_id`, `name`, `price`, `active`, `createdAt`, `tags`, `meta`). A `bson.M` decode would pass every other test in the file and fail this one |

C24 governs every mutating case: `mutate_probe`, `literal_probe` and `slow_probe` are created per
test from the root client, never `widgets`.

### 5.4 The Redis Go tier

`shell/internal/adapters/redis/redis_test.go`, `redis:7`, seeded per §4.5. 20 of 24 scenarios port
as-is — the highest ratio in P58, because redis's spec is almost entirely about the adapter's own
per-type logic rather than about a driver.

| Test | Why it is called out |
|---|---|
| **hash/set/zset paging asserts "some rows, more to come", never an exact count** (spec 8/9/10 + 13, ported with §1.11's constraint made explicit) | HSCAN's `COUNT` is a hint; `readScanFamily` accumulates whole rounds and can overshoot `pageSize`. A Go assertion of `len(fields) == pageSize` would pass on the small seeded hash and fail nondeterministically on `user:1:bighash`. Assert `> 0` and `hasMore == true`, and for the small hash assert the exact **set** of pairs, order-independent |
| **an `offset` cursor on a cursor-paged key restarts the scan** (spec 24, ported verbatim) | `views/keyvalue/state.ts`'s D40 depends on this exact behaviour for its reload path. It is a contract, not an implementation detail, and the Go port must neither error nor seek |
| **a vanished key is `E_QUERY`, not `E_NOT_FOUND`** (spec 15, ported verbatim) | P9 D10, and the reason is in `viewOp.ts`'s `DISCONNECTED_CODES` — the wrong code gates a tab behind "Reconnect & load" for a key that merely expired |
| **`truncated` is set only when the round cap cut the scan short** (spec 3's negative half, plus a new positive half) | P43 iter2 F16/D21. The existing spec only asserts the negative (an ordinary listing leaves `truncated` unset). A Go test should add the positive against a temporarily lowered cap or a db1 keyspace seeded past 200 rounds — this is the only `Truncated` producer in the app (§1.1) and the browse tab's truncation strip has no other source |
| **`children()` of a key leaf marshals as `"nodes":[]`, not `"nodes":null`** (new, C16) | §1.3 gap 4. `len(nodes) == 0` passes for a nil slice; the assertion has to be over the marshalled JSON |
| **cancel is a permanent no-op** (spec 21, ported verbatim) | C9. `Cancel(uuid)` returns `false` and `caps.Cancel` is `true`, together, in one test, with the reasoning in a comment — otherwise the next reader "fixes" one of the two |
| **the console tokenizer** (C12, unit-level, no container) | Quoted and unquoted tokens, an escape inside quotes, an escape outside quotes (not honoured), an unterminated quote → `E_QUERY "unterminated quoted string"` |

C23 governs every mutating case: they run against **db index 1**.

**Not ported:** spec 22 (the partially-failed-mutate cache invalidation) — its subject moved to
`adapterhost` in P58a M4 and is covered by `data_test.go`'s
`TestDispatcher_Mutate_InvalidatesEvenOnFailure`. §1.12 says so; recording it here is what makes the
deletion checkable rather than a judgement call, per `AGENTS.md`'s standard (*"the thing to check is
that the Go test actually covers the same assertion"*).

### 5.5 Unit-level, against `AGENTS.md`'s bar

Exactly two things in P58c clear it, and P58 §5.4's own table already named the first:

| Subject | Why it qualifies |
|---|---|
| **`mongo/literal.go`'s tokenizer and parser** (P58 D11, C4, C5) | *"A parser or splitter with several interacting lexical rules"*, verbatim from the bar. Table-driven, **written before `literal.go`** (§9). Case groups: every escape in the nine-entry table plus `\uXXXX` plus an unknown escape; both quote styles; an unterminated string; both comment forms including an unterminated block comment; a trailing comma in an object and in an array; a bare identifier that is not a literal or a constructor; `ObjectId` without parentheses; each of the six constructors with and without an argument; `undefined` → null; **an unadorned number is a float64** (C5); an invalid number (C4's one new message); each of the thirteen EJSON wrapper keys; a wrapper whose value is the wrong type (falls through as a plain object, C4); a resolved BSON instance nested inside a plain object (passes through untouched); field order preserved through a nested object; and the five position-bearing error messages asserted **byte for byte** |
| **`redis/console.go`'s tokenizer** (C12) | Three interacting rules and one error, and it is the console's entire input path |

Everything else gets nothing, per the bar's own list. In particular: **no unit test for
`readScanFamily`, `IDText`, `dbIndexFromName`, `formatReplyItem` or the `sslmode` maps** — each is a
short function whose behaviour the acceptance suite pins against a real server, and *"a branch is not
complexity."*

### 5.6 `tests/e2e-real/` — the full suite, after every flip, and this is not optional

`AGENTS.md`'s P58b M6.4 finding, restated as this sub-phase's own rule because P58c is where it is
most likely to bite:

> **A `tests/e2e-real/*.spec.ts` regression sweep must be re-run in full after every `nativeKinds`
> flip, not just for the kind that just went native**, because a shared code path — `adapterhost.Router`
> above all — is common to every native adapter and can silently break an *already-native* kind's
> wire format at the same time.

The concrete reason it is sharper here than in P58b: **C16 edits `Router.childrenNative`**, a
function every native adapter's tree expansion goes through, in M7.1 — one milestone before either
flip. A mistake there breaks Postgres, MariaDB, MySQL, SQLite and ClickHouse simultaneously and is
invisible to every mocked tier, exactly like the `referencedBy: null` regression that motivated the
rule. So:

- **M7.1 ends with the full `tests/e2e-real/` suite green** — `postgres-real.spec.ts` (2 tests),
  `sqlite-real.spec.ts`, `mariadb-real.spec.ts` (2 tests, the second now Kafka-paired per C15) —
  even though `nativeKinds` did not change.
- **M7.3 and M7.4 each end with the same full sweep**, not just with their own adapter's suite.
- The sweep's own `expect(consoleErrors).toEqual([])` assertions are what make it worth running;
  do not weaken them.

**P58c adds no new `tests/e2e-real/` spec.** P58 §5.5 is right that this tier is deliberately small
and that one spec per newly-native engine is *"tempting and mostly wrong"*; P58b added one only
because checkpoint C1b had no other vehicle. P58c's own checkpoint C1c reuses the vehicle C15 has
already re-pointed, so there is nothing new to add (§7).

### 5.7 What P58c deliberately does not test

- **The `tests/ipc/redis/` fixtures against the Go producer.** §1.11 — P58 D13's job, P58f's
  milestone. Doing one of seven early would leave two generators in the tree.
- **Packaging.** No bundle change; `verify-packaging.sh` is untouched and still correct.
- **The base64 wire encoding through `tests/ui/`.** P58a A10, unchanged.
- **Mongo's `killOp` against a sharded cluster.** The `opid`-is-not-a-number case (`index.ts:28-32`)
  is preserved in the code and its comment, but a sharded fixture is far out of proportion to the
  risk; MG-2 records the single-node shape and the code stays type-agnostic.

## 6. M7.0 — the probes, concretely

Four throwaway Go programs under the scratch directory (**never committed; no product code lands in
M7.0**), each answering one question with a printed PASS/FAIL. The deliverable is a findings
subsection appended to this document (§9 commit 1) and, for anything surprising, an `AGENTS.md`
entry. Ordering: TC-3 first (everything else needs containers), then MG-1 and MG-2 against the Mongo
container it proves, then RD-1.

**The probes below are written against `AGENTS.md`'s own hardest-won lesson about probes**, from
P58b M6.3: *"an M6.0-style probe is only as complete as the specific inputs it tried."* SQ-1 tested a
garbage `'not a date'` string and concluded "no coercion" — true for that input, false in general,
and the real bug was found later by probing a *valid-looking* value. MG-1 and RD-1 are therefore
written as **input inventories**, not as capability checks.

| Probe | What it runs | Asserts | If it fails |
|---|---|---|---|
| **TC-3** | `testcontainers-go` + `modules/{mongodb,redis}@v0.44.0` starting `mongo:7` and `redis:7` (both mirror-retagged via `library/`), running `buildInfo` and `PING`, terminating. For mongo, start it **with `MONGO_INITDB_ROOT_USERNAME`/`PASSWORD` set**, which is the configuration the fixture needs; for redis, start it **with a password** | Both start in this sandbox. Specifically: (a) whether `modules/mongodb`'s own wait strategy survives the entrypoint's **double boot** (§1.13) or resolves on the first, throwaway, auth-less instance and hands back a port that stops answering a moment later — the exact shape P58b's TC-2 checked for MySQL/MariaDB; (b) whether `modules/redis`'s `WithPassword` behaves (P58b's ClickHouse `WithPassword("")` finding); (c) that neither module sets a `ulimit` this sandbox's fixed 20 000 ceiling rejects | The Go fixture for that engine gets its own explicit wait strategy (`wait.ForLog(..., 2)`, the shape `tests/db/support/mongo.ts:48` already uses), or drops the module and uses a bare `testcontainers.GenericContainer` — the shape `tests/db/support/mongo.ts` itself uses, since there is no `@testcontainers/mongodb` on the TypeScript side either |
| **MG-1** | Against the Mongo container, seeded with the **real** `widgets` shapes (§4.5): read every document as `bson.Raw`, render each with `bson.MarshalExtJSON(raw, true, false)`, print the exact bytes. Then do the same for `_id` alone, for a `Decimal128`, a `Binary`, a `Timestamp`, a nested document, an array, a `null` field, an empty array, an empty document, a `<`/`>`/`&`-bearing string, a non-ASCII string, and an integral **double** (`3.0`) alongside a real `int32` (`3`). Alongside, run the **same** documents through the TypeScript side (`bun` + the `bson` package's `EJSON.stringify(doc, {relaxed:false})`) and **diff the two outputs character by character**. Separately, print `MarshalExtJSON(raw, false, false)` piped through `json.Indent` for the `validated_widgets` validator, and diff it against `EJSON.stringify(v, undefined, 2, {relaxed:true})` | For each of the ~14 inputs: identical, or **differing in a named, understood way**. The two divergences §1.4 predicts (an integral double rendering `$numberDouble` in Go and `$numberInt` in JS; HTML escaping if `escapeHTML` were true) must appear exactly where predicted and nowhere else. Whitespace, key order, and `$oid`/`$date`/`$numberDecimal`/`$binary`/`$timestamp` wrapper spelling must match | A third divergence means C2's *"a fidelity gain, recorded as a change"* framing is wrong and the MongoDB half needs a rendering-compatibility layer — a materially larger job that must be re-planned, not absorbed. **Do not proceed to M7.3 on a partial diff**: the whole point of this probe is that a spot check on `widgets` alone would have missed the `<` case |
| **MG-2** | Against the same container, as the **unprivileged `kira` user** (not root): start a long operation carrying `comment: <opId>`; from the same client run the `$currentOp: {allUsers:false, idleConnections:false}` aggregation on `admin` and `$match` `command.comment`; issue `{killOp: 1, op: <opid>}`; observe (a) what error the killed operation's own call returns and (b) that `$currentOp` stops matching. Separately: confirm `$expr: {$function: {lang:"js"}}` is accepted on `mongo:7` (scenario 22's own slow-operation mechanism); and confirm that a `context.Context` cancelled mid-operation returns promptly **and leaves the pooled client usable for the next call** | (a) `$currentOp` with `allUsers:false` works for a non-admin user — the claim `index.ts:190-195` makes and the whole fallback rests on; (b) the killed operation's error is a **server** error mapping to `E_QUERY`, not a client-side cancellation mapping to `E_CANCELLED` (`mongo.spec.ts:806-809` asserts exactly this distinction); (c) `$function` is available, or a named substitute is; (d) the ctx-cancel path is clean | (a) failing means the fallback needs a privilege the fixture's user does not have and `caps.cancel` has to be re-examined — stop and raise it. (c) failing means scenario 22's slow operation is re-derived as a large `$group`/`$sort` over `big_widgets`, recorded here, before M7.3 |
| **RD-1** | Against the Redis container, seeded with the **real** §4.5 shapes: (a) `HSCAN user:1:bighash` (5 000 fields) in a loop with `COUNT 1000`, printing per-round field counts and the cursor — **run twice against two freshly-seeded containers** and diff the two field orders and the two round boundaries; (b) the same for `SSCAN`/`ZSCAN` on the small seeded keys, and `SCAN MATCH user:1:*`; (c) start a `DEBUG SLEEP 3` (or a `LRANGE` over a 1 000 000-element list) on a pooled client, cancel its `context.Context` mid-flight, then immediately issue `PING` **on the same `*redis.Client`** and report whether it succeeds; (d) print `client.Options().Protocol`, then run `HGETALL`, `CONFIG GET maxmemory` and `XRANGE` through the **generic** `Do(ctx, ...)` path under the default protocol and under `Protocol: 2`, printing the Go type and shape of each reply; (e) `TYPE`/`PTTL`/`MEMORY USAGE` against a key with a TTL, one without, and one that does not exist; (f) `SET k v NX` against an existing key, printing the exact error/reply | (a) reproduces §1.11's finding — HSCAN's order and round boundaries are **not** stable across identically-seeded containers, and a round can return well over `COUNT` — so §5.4's assertions are written against "some rows, more to come" from the start rather than after a flaky CI run; (b) the SCAN family's Go iteration shape matches ioredis's `[cursor, elements]` pairing; (c) the poisoned-connection question C9 sidesteps, answered either way; (d) the default protocol version and the three reply-shape divergences C10 pins RESP2 for; (e) `PTTL`'s −1/−2 and `MEMORY USAGE`'s availability; (f) go-redis's `SET … NX` failure shape, which is `redis.Nil` rather than a non-`OK` string (§4.3) | (a) failing in the *other* direction (stable order) is a welcome result to **record, not to rely on** — the TypeScript fixture's own two freezes exist because it was not stable there. (c) failing (a poisoned connection) confirms C9's choice; succeeding cleanly is recorded as the evidence a later phase would need to revisit it. (d) any divergence from the assumption makes C10's explicit `Protocol: 2` the fix rather than a precaution |

## 7. Checkpoint C1c — the checklist

P58 §0.3 defines checkpoint C1 (after M5) and checkpoint C2 (before M10) and assigns no checkpoint to
M7. P58b §7 added **checkpoint C1b** for M6 on the grounds that it was *"the half of C1 that P58a
could not run"*, and §10 OQ-5 raised the numbering to the parent's author. This plan adds
**checkpoint C1c** on narrower and more concrete grounds: **P58c is the sub-phase that breaks the
vehicle checkpoint C1b ran on** (§1.9), so a plan that re-points that vehicle owes a re-run of the
proof on the new pairing. Not a new proof — the same proof, on a pairing that survives this
sub-phase.

**This sandbox has no real X display**, which P58a §13 established and nothing since has changed. So
checkpoint C1c is written for the `tests/e2e-real/` substitute both predecessors actually used — a
real `-tags server` Go binary, real bindings, real containers, real UI code paths, reached over
`http://127.0.0.1` from a headless browser tab — and **not** for `xdotool`/`import -window` steps that
cannot run here. Every step is either a `tests/e2e-real/` assertion or a shell observation made in
the **same** Bash invocation as the app run (`AGENTS.md`, P51; budget 150 s).

**Preparation** (one Bash invocation)

1. `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`; wait for `API listen on /var/run/docker.sock`.
2. Pull and retag `mariadb:11.4` (via `mirror.gcr.io/library/`) and `confluentinc/cp-kafka:8.0.7`
   (already namespaced — **no** `library/` prefix).
3. `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`;
   `go install …/wails3@v3.0.0-beta.15` (**pinned**); `scripts/vendor-node.sh` and
   `bun run build:engine` — **the Node child is still required**, it serves four of eleven kinds
   after M7.4; `wails3 generate bindings -b -i -ts -names`; `bun run build`.
4. `bunx playwright test --project=e2e-real`, which builds `go build -tags server` itself through
   `tests/e2e-real/fixtures.ts`.

**The native half — MariaDB, in Go** (unchanged from checkpoint C1b; it is the regression half)

5. The app boots and `[data-testid="status-bar"]` is present.
6. A MariaDB connection is created through the real dialog, tested and connected; its status dot
   reads `connected` with a `MariaDB 11.` tooltip.
7. The tree expands to relations with `~N rows` details.
8. `kira_test.order_items` opens and renders **real cell text** — the base64 chunk path end to end.
9. `big_rows` pages forward and back with `[data-testid="pager"]` carrying
   `data-pagination="keyset"`.

**The coexistence half — Kafka, still on Node** (C15's re-pointing, and the load-bearing half)

10. In the **same session**, a Kafka connection is created and connected; its tree expands to a
    seeded topic and a stream page renders. Its pages arrive in the **index-keyed** encoding — so
    this step is simultaneously the live proof that `toTypedArray`'s second branch is still needed
    (P58a A9/A10).
11. `[data-testid="engine-status"]` is `ok` throughout (P58a A17: `ping` is still answered by the
    child).
12. The Node child is `SIGKILL`ed — found as a real process child via
    `pgrep -P <KiraApp.serverPid>`, the addition P58b's own §13 made to `fixtures.ts` for exactly
    this. The **Kafka** connection flips to `error`; the **MariaDB** connection stays `connected` and
    still serves a real read after a `page.reload()` (P58a A15). If MariaDB also flips,
    `MarkAllErrored` was not narrowed — or was narrowed against a stale `nativeKinds` snapshot.

**The P58c-specific half — a native document page and a native key/value page** (new)

13. Still in the same session: a **MongoDB** connection (now native) connects, its tree expands to
    `kira_test/widgets`, and a document tab renders `[data-testid="document-tree"]` with **real
    field text** — the first `DocumentPage` ever produced by Go and decoded through the base64
    branch. This is the P58c analogue of the step that caught P58a's `toTypedArray` bug and P58b's
    `referencedBy: null` bug, and it is the only place in the whole phase where a Go-built
    `DocumentPage` meets the real renderer.
14. A **Redis** connection (now native) connects, its db0 node opens a **Browse tab**, the
    `:`-namespace tree navigates to `user:1:profile`, and a key/value page renders both fields with
    a real `ttlMs`/`memoryBytes` header. First Go-built `KeyValuePage`, first native
    `caps.keyBrowser` engine, first native `TreeChildren.Truncated` producer.

**Recording.** Checkpoint C1c is recorded in the M7.4 commit message and in `AGENTS.md`'s P58c
findings entry, naming which of steps 5–14 passed and which could not be run, per P55 §10 / P56 §6 /
P57 §6 / P58a §13 / P58b §13's standard of recording *"not available in this session"* rather than
leaving it implied. Steps 12, 13 and 14 are the load-bearing ones.

## 8. Acceptance criteria

**Per milestone**

- **M7.0** — all four probes have a recorded PASS, or a recorded FAIL with its consequence taken
  explicitly (§6). **No product code committed.** C2's rendering claim and C10's protocol claim are
  either confirmed or corrected in writing before M7.3/M7.4 start.
- **M7.1** — `go test ./... -race` in `shell/` green with **`nativeKinds` unchanged**;
  `grep -rn '"mongodb"\|"redis"' shell/internal --include=*.go` returns **only**
  `internal/storage/model/connection.go`'s valid-kind set; `adapterhost.TestKindNodeServed` is
  `"kafka"` and its doc comment names P58e; `router_test.go`'s `fakeKind` is untouched;
  `childrenNative` normalizes nil `Nodes` and a test asserts the marshalled `"nodes":[]`;
  `tests/e2e-real/support/mongo.ts` is gone and `mariadb-real.spec.ts`'s second test connects Kafka;
  **the full `tests/e2e-real/` suite is green** (§5.6 — this milestone edits a code path every
  native adapter shares); `git diff --stat src/` empty.
- **M7.2** — `go test ./internal/adapters/mongo/` green over `literal_test.go` alone, **with no
  Docker**; `literal.go` imports no driver and no third-party parser; every error message is
  byte-identical to `literal.ts`'s except C4's one new one, which is recorded; `git diff --stat src/`
  empty.
- **M7.3** — `go test ./internal/adapters/mongo/` green against a real container, or explicitly
  recorded as Docker-unavailable; `nativeKinds` contains `mongodb`; **`shell/main.go` has the blank
  import** (§4.6's most-forgotten step); §5.3's four called-out cases all present and passing;
  `tests/db/mongo.spec.ts` deleted in the milestone's last commit, `tests/db/support/mongo.ts`
  **kept** after a re-grep (C21); the whole existing suite (`bun run lint`, `bun run typecheck`,
  `bun run test:unit`, `bun run test:go`, `bun run test:ui`, `bun run test:ipc:fe`) green; **the full
  `tests/e2e-real/` suite green** (§5.6); `git diff --stat src/` empty.
- **M7.4** — `go test ./internal/adapters/redis/` green against a real container; `nativeKinds`
  contains `redis`, reaching **seven of eleven**; `shell/main.go` has the second blank import;
  §5.4's seven called-out cases all present and passing; **checkpoint C1c recorded** (§7);
  `tests/db/redis.spec.ts` deleted last, `tests/db/support/redis.ts` **kept** after a re-grep;
  **the full `tests/e2e-real/` suite green**; `git diff --stat src/` empty.

**Phase-level**

1. Checkpoint C1c's checklist is recorded with a per-step result, including "not run in this
   session" where that is the honest answer (§7).
2. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`,
   `bun run test:ui`, `bun run test:ipc:fe` are green.
3. `cd shell && go test ./... -race` is green. **`-race` is the bar, not plain `go test`** — both new
   adapters run their driver call on a goroutine (`RunWithAbortRace`) and register/release from
   another, and `mongo`'s `runningByOp` map is the same shape whose missing mutex the race detector
   is the only thing that finds (P58b §11's own note).
4. **`git diff --stat src/` is empty.** Not "empty except one file" — empty (C22).
5. **`git diff --stat tests/ui tests/ipc` is empty**, including every `*.fixture.ts` (§1.11).
6. `git diff --stat shell/internal/page shell/internal/enginecache shell/internal/enginebackend`
   is empty (§1.3 — the substrate needed nothing).
7. The whole `git diff --stat` scope, enumerated in advance so a surprise is visible:
   - **`shell/internal/adapters/`** — two new directories (`mongo/`, `redis/`), `testsupport/`
     grown by two fixtures and one edited `spec.go`.
   - **`shell/internal/adapterhost/`** — `router.go` (`TestKindNodeServed`, `childrenNative`,
     `nativeKinds` ×2) and `router_test.go`.
   - **`shell/main.go`** — two blank imports. **`shell/go.mod`/`go.sum`** — two runtime modules,
     two test-only.
   - **`tests/db/`** — two spec deletions, no support deletions. **`tests/e2e-real/`** — one edited
     spec, one deleted support file, one new one.
   - **`docs/`, `AGENTS.md`** — per §3.
   - **`src/`, `tests/ui/`, `tests/ipc/`, `package.json`, `scripts/`, `.github/`** — nothing.
8. `AGENTS.md` gains a **"P58c implementation findings"** entry on the P52–P58b pattern, carrying at
   minimum: M7.0's four probe results; whether C2's byte-level rendering claim survived MG-1 and
   **what the integral-double divergence actually looks like on `widgets`**; whether C10's RESP2 pin
   was necessary; the two placeholder moves (C14, C15) and the general lesson that **a placeholder
   parked on "the next sub-phase's kind" is a debt that sub-phase inherits, in test constants and in
   `tests/e2e-real/` alike**; §1.10's two unmet P58b closeout claims, recorded as observed; and
   whatever flipping a document-shaped and a key/value-shaped kind turned up that this plan did not
   predict.
9. `docs/ARCHITECTURE.md` is updated: the **per-database mapping table's Redis Cancel cell** (the
   stale `CLIENT KILL` claim, §1.7) and its **MongoDB row** (both now Go-native); the
   **MongoDB / Redis per-engine section** extended the way P58b extended SQLite's and ClickHouse's
   — which kinds are Go-native, the drivers, C2's rendering-fidelity change, C9's honest
   `cancel: true`-with-a-no-op-`Cancel`, and C10's RESP2 pin; the **Stack** table's driver line
   (`mongodb`/`ioredis` out, `mongo-driver/v2`/`go-redis/v9` in); and — per OQ-2 — the mapping
   table's **SQLite Cancel cell**, left stale by P58b.
10. This document gains its own **§12 M7.0 results** and **§13 M7.1–M7.4 results** sections, the way
    P58a's and P58b's §12/§13 record what actually happened — including any decision that turned out
    wrong.

## 9. Sequencing

Five milestones, in order, with the commits inside each. The parent's hard rules apply unchanged:
its **R2** (the substrate lands before any adapter) is why M7.1 is a milestone rather than four
scattered edits; its **R3** (an adapter's Go tests land and fail before its implementation) is
encoded in M7.2–M7.4's commit lists; its **R4** (probes before the work they inform) is why M7.0 is
first; its **R1** is P58f's and does not bind here.

**M7.0 — probes** *(no commits to `shell/`)*
1. `docs: record P58c M7.0 probe results` — this document gains a findings subsection; C2 and C10 are
   confirmed or corrected in writing.

**M7.1 — the shared lifts** *(`nativeKinds` unchanged throughout)*
2. `refactor(adapterhost): move the Node-served placeholder kind off mongodb` —
   `TestKindNodeServed = "kafka"`, doc comment naming P58e (C14). Existing tests unchanged and green.
3. `test(e2e-real): pair the coexistence proof with kafka, not mongodb` —
   `mariadb-real.spec.ts`'s second test, `support/kafka.ts` in, `support/mongo.ts` out (C15). The
   commit message records the run.
4. `fix(adapterhost): a native adapter's empty children list crosses the wire as [], not null` —
   `childrenNative`'s normalization plus its marshalled-JSON test (C16). **Full `tests/e2e-real/`
   sweep runs here** (§5.6).
5. `test(testsupport): document and key/value page readers` — `spec.go`'s `DocIDAt`/`DocBodyAt`/
   `KVPairs`/`KVValueAt`.

**M7.2 — `literal.go`, alone** *(no Docker)*
6. `test(mongo): the literal parser's oracle, before the parser` — `literal_test.go`, **failing**
   (P58 D11's *"written first"*, and R3 applied below milestone granularity).
7. `feat(mongo): the JSON5-lite tokenizer and BSON-constructor parser` — `literal.go`, green.
8. `feat(mongo): resolve extended-JSON wrappers inside a parsed literal` — `ResolveEJSONWrappers`
   and the three entry points, with their own cases.

**M7.3 — MongoDB**
9. `test(mongo): a container fixture with its unprivileged user and its five collections` —
   `testsupport/mongo.go` plus a trivial connectivity test proving the seed matches §4.5.
10. `test(mongo): the Go acceptance suite, against a real container` — `mongo_test.go`,
    `main_test.go`, **failing** (P58 D12 / R3), including §5.3's four called-out cases.
11. `feat(mongo): client, connect and error mapping` — `client.go`, `errors.go`, `caps.go`, and
    `adapter.go`'s connect/disconnect.
12. `feat(mongo): the catalog, the tree and the definition view` — `catalog.go`, `definition.go`,
    `adapter.go`'s children/describe/definition.
13. `feat(mongo): read, count and the EJSON document codec` — `read.go`. The codec is what C2 and C3
    exist for, so this is the commit to review hardest.
14. `feat(mongo): mutations, the shell console and killOp cancellation` — `mutate.go`, `console.go`,
    `adapter.go`'s `Cancel` (C6).
15. `feat(adapterhost): serve mongodb in-process` — `nativeKinds += mongodb`, `main.go` += one blank
    import. **Full `tests/e2e-real/` sweep runs here**; the commit message records both it and the
    acceptance run.
16. `test: delete tests/db/mongo.spec.ts, its subject now in Go` (C20) — **re-grep `support/mongo.ts`'s
    consumers first** (C21, §1.10's snapshot caveat).

**M7.4 — Redis, and checkpoint C1c**
17. `test(redis): a container fixture, two db indices, six types` — `testsupport/redis.go`.
18. `test(redis): the Go acceptance suite, against a real container` — `redis_test.go`,
    `main_test.go`, plus `console_test.go`'s tokenizer cases, **failing**.
19. `feat(redis): the per-db-index client set and error mapping` — `client.go`, `errors.go`,
    `caps.go`, `adapter.go`'s connect/disconnect (C8, C10).
20. `feat(redis): the SCAN namespace tree and its round budget` — `catalog.go`, `adapter.go`'s
    children. Carries the only `Truncated` producer in the app.
21. `feat(redis): six per-type readers and four page positions` — `read.go`. The densest file in the
    package (§1.2).
22. `feat(redis): mutations and the CLI console` — `mutate.go`, `console.go`.
23. `feat(adapterhost): serve redis in-process` — `nativeKinds += redis`, `main.go` += one blank
    import. Seven of eleven. **Full `tests/e2e-real/` sweep runs here.**
24. `test: delete tests/db/redis.spec.ts, its subject now in Go` (C20) — **re-grep first**.
25. `docs: P58c findings — a document codec, a key/value adapter and two placeholders that had to
    move` — `AGENTS.md`, `docs/ARCHITECTURE.md`, and this document's §12/§13. **Checkpoint C1c runs
    before this commit** and its result is recorded in it.

**Why `literal.go` gets its own milestone.** P58 D11 says it is written first; this plan makes it a
*milestone* rather than a commit inside M7.3 for the same reason P58a made `internal/page` its own
milestone: it is the one piece of P58c that needs no container, no driver and no network, so it is
the one piece that can be finished and proven on a session where Docker will not start — and it is
the piece whose correctness the other nine mongo files silently assume.

**Why MongoDB before Redis.** Mongo carries D11, which is the phase's named risk, and it is the kind
both of M7.1's placeholder moves are *about* — landing it second would leave `TestKindNodeServed`
pointing at a kind that went native two commits earlier for a whole milestone. Redis is also the
better second: its six per-type readers are six small independent problems rather than one large
one, so it degrades gracefully if the milestone runs long, and its checkpoint C1c steps (13, 14) want
the Mongo half already working.

## 10. Open questions for the parent plan's author

Each of these affects P58d–P58f as much as P58c, or records a predecessor plan's claim that the tree
contradicts. None is silently resolved; where P58c needs a working assumption to proceed it is stated
as *interim* and marked reversible.

**OQ-1 — P58b's four `tests/db/*.spec.ts` deletions never landed, and P58c is about to follow the
same instruction.** §1.10. `tests/db/{mariadb,mysql,sqlite,clickhouse}.spec.ts` are all still in the
tree at `223cf02`; the only spec ever deleted is `postgres.spec.ts`. So `bun run test:db` still runs
four full container suites against TypeScript adapters that serve no real connection, and P58 D12's
third rule (*"deleted only when its Go successor passes, per adapter, in the sub-phase that ports
that adapter — never as a batch in M10"*) has been observed once out of five opportunities. Three
dispositions, and the choice is the parent's because it is about the phase's own test-tier story, not
about P58c: (a) P58c deletes its own two and records the other four as outstanding (**P58c interim**,
C20); (b) P58c deletes all six in one commit, absorbing another sub-phase's closeout; (c) the rule is
amended and every `tests/db/*.spec.ts` retires in P58f alongside `src/engine/`, which would at least
be honest about what is happening. Note that (c) has a real argument behind it — a still-passing
TypeScript spec is a live oracle to diff a Go port against, which P58b §11 explicitly recommended
using for SQLite — but it is an argument nobody has made in writing yet.

**OQ-2 — `docs/ARCHITECTURE.md`'s per-database mapping table's SQLite Cancel cell is still
`"none — SQLite has no interruptible statement"`.** §1.10. P58b §8 criterion 9 required it; the
per-engine section (line 211) was rewritten beautifully and the table cell (line 96) was not. P58c
edits the same table for Redis and MongoDB, so fixing SQLite's cell costs one line and one commit.
**P58c interim: fix it**, and say so in the commit message. The parent's author may prefer that a
sub-phase never edits another's rows; if so, say so, because the alternative is that the table stays
wrong until someone notices twice.

**OQ-3 — checkpoint C1b's coexistence pairing has to move once per sub-phase from here on, and
nobody has decided where it stops.** §1.9. P58b paired MariaDB (native) with MongoDB (Node-served);
P58c must re-pair it because MongoDB goes native here. C15 picks **Kafka**, on the grounds that it is
the last kind to go native (P58e) and so is the last move required — but that means **P58e must
delete or rewrite the coexistence half entirely**, because after M9 there is no Node-served kind left
to pair with, and P58f's checkpoint C2 (*"a full manual pass across all eleven kinds leaves the
engine child's request counter at zero"*) is a different proof of a different property. Three things
for the parent's author to settle: whether Kafka or RabbitMQ is the right pairing here (Kafka lives
longer; RabbitMQ is lighter and has no native addon); whether P58e is expected to delete the second
test or convert it into checkpoint C2's own vehicle; and whether `mariadb-real.spec.ts` should be
renamed to something that does not name one of its two connections, since it has now been re-pointed
once and will be again.

**OQ-4 — C2's rendering-fidelity change is a user-visible behaviour change and P58 §7's lists do not
have a slot for it.** §1.4. Go renders a stored BSON double `3.0` as `{"$numberDouble":"3.0"}` where
the TypeScript rendered `{"$numberInt":"3"}`, because `bson.Raw` keeps the type tag the JS driver
discards. It is a **gain** — the document view stops lying about what is stored — and P58 §7's
*"what gets better"* list is where it belongs, alongside D7's Kafka capability recovery and D8's
SQLite cancellation. But it is also the first entry on either list that changes what an existing
user sees on an existing document with no capability attached to it, which is a slightly different
kind of item than either list currently holds. **P58c interim: record it as a gain, in
`docs/ARCHITECTURE.md` and `AGENTS.md`, and pin it with a test** (§5.3). If the parent's author
would rather the Go side reproduce the TypeScript's lossy rendering for continuity, that is a
materially larger job (a JS-number-semantics emulation layer over every numeric BSON value) and must
be decided before M7.3, not after.

**OQ-5 — a placeholder parked on "the next sub-phase's kind" is a debt that sub-phase inherits, and
this has now happened twice in two different tiers.** §1.8 and §1.9. P58b B16 chose `"mongodb"` for
`TestKindNodeServed` *because* it had no Go adapter and none scheduled before P58c — correct at the
time, and it made P58c's own fix a one-line change, which is exactly what B16 was for. P58b's
checkpoint C1b made the same choice one tier up, in a `tests/e2e-real/` spec, where it is **not** a
one-line change and where its failure mode is a green test that proves nothing. The general rule
worth writing into the parent plan for P58d/P58e: **when a test needs "a kind that is definitely
still Node-served", it must name the kind that goes native *last* (`kafka`), not the kind that goes
native *next*** — and the same rule applies to `tests/e2e-real/` fixtures, not only to Go test
constants. P58c applies it (C14, C15); the parent's §4.6 or §9 is where it belongs so P58d does not
have to rediscover it.

## 11. Environment notes for the implementing session

- **A fresh container has none of the toolchain.** Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package. `./internal/adapters/...` needs none of it, so the
  fast loop for the whole of M7.1–M7.4 is `go test ./internal/adapters/{mongo,redis}` and never
  `./...`. Only checkpoint C1c and M7.1's `tests/e2e-real/` sweep need the headers.
- **M7.2 needs no Docker at all.** `literal.go` and `literal_test.go` are pure computation. Good
  work for a session on which the daemon will not start — the same property P58b's SQLite milestone
  had.
- **cgo is already on and cannot be turned off** for the module as a whole (`mattn/go-sqlite3` in
  `internal/storage`, `modernc.org/sqlite` in `internal/adapters/sqlite`, Wails' GTK bindings in
  `internal/shell`). Both of P58c's drivers are pure Go, but that is not why they were chosen and
  `CGO_ENABLED=0` is not an option to reach for.
- **Install `wails3` pinned** to `shell/go.mod`'s exact version (`v3.0.0-beta.15`), never `@latest`
  (P55's finding).
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`) before `bun run build` resolves its imports. P58c
  changes no bound method signature, so one regeneration per fresh container is enough.
- **`shell/runtime/` is git-ignored too**, and P58c still needs both halves: `scripts/vendor-node.sh`
  for `runtime/node/bin/node` and `bun run build:engine` for `runtime/engine/engine.cjs`. The app
  refuses to start without the engine bundle (P56 D12), and after P58c the child still serves **four
  of eleven** kinds (`kafka`, `sqs`, `s3`, `rabbitmq`).
- **Docker**: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown` here; `colima start` on macOS. Pull
  every image through `mirror.gcr.io` and retag to the plain name. P58c's images: **`mongo:7`** and
  **`redis:7`** (both official → `mirror.gcr.io/library/…`), plus — for checkpoint C1c only —
  `mariadb:11.4` (official → `library/`) and `confluentinc/cp-kafka:8.0.7` (**already namespaced →
  no `library/` prefix**).
- **`mongo:7`'s entrypoint boots twice** when `MONGO_INITDB_ROOT_USERNAME` is set (§1.13). Whatever
  wait strategy the Go fixture ends up with, waiting for the *first* "Waiting for connections" gets
  a refused connection a moment later — the TypeScript fixture waits for the second occurrence and
  says why.
- **`bun test tests/db/{mongo,redis}.spec.ts` runs here and is a live oracle** to diff the Go port
  against, exactly as P58b §11 recommended for SQLite. Both are Docker-gated, both pull through the
  mirror, and both are worth running once before writing their Go successors — especially
  `mongo.spec.ts`, whose EJSON expectations are the reference MG-1 diffs against.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (P51's finding, still true). Checkpoint C1c's app run — start, exercise, tear down — is one Bash
  invocation with a 120–150 s timeout.
- **There is no real X display here**, so checkpoint C1c is written against `tests/e2e-real/` rather
  than `xdotool`/`import -window` (§7). Do not spend a session trying to make the screenshot path
  work; P58a already established that it does not.
- **`go test ./... -race` is the bar**, not `go test ./...`. Both adapters run their driver call on a
  goroutine (`RunWithAbortRace`) and register/release from another; the race detector is the only
  thing that will find a missing mutex in `runningByOp` or in `DbConnectionSet`'s LRU.
- **Comparing a struct containing an `any` field with `==` panics at runtime** rather than failing to
  compile (P55's finding). `model.ConnectionState.Caps` is such a field — use `go-cmp` (already a
  dependency), never `==`. This bites harder in P58c than in P58b because `bson.D` and `bson.RawValue`
  are both `any`-bearing at the leaves; use `go-cmp` for every document comparison too.
