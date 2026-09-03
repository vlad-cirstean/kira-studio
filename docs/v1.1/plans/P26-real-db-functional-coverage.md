# P26 — real functional coverage on P25's harness: load, write, delete, filter, DDL

> **What this phase is.** P25 built a two-tier real-container test harness and populated it with
> auth/config cases only, deliberately leaving `Scenario`/`Requires` as an unused seam for exactly
> this phase (P25 §3.2, and the `AGENTS.md` bullet that names P26 by number). This phase decides
> what *functional* coverage — data load, write, delete, filter/query, and DDL where the adapter has
> a DDL surface at all — is worth running against a real container per adapter, and attaches it to
> that harness rather than building a parallel mechanism.
>
> **The harness needs almost nothing.** §2.1 verifies against the real `testsupport/matrix.go` that
> `Case`/`Outcome`/`RunMatrix` need **no change at all** and `Scenario` needs no field added — a
> per-adapter path is captured in the scenario's own closure, which is what makes a shared library
> possible without a config DSL. One new helper function (`RunScenarios`) and one generalized Kafka
> fixture helper are the entire infrastructure delta.
>
> **The audit found four real gaps and one cross-adapter finding, all read from source at this
> phase's base commit** (`f4a81d6`, branch `claude/feature-v1-1-p5-onwards-2isfzt`). The
> cross-adapter one is the important one: **four of the ten adapters map an *authorization* failure
> to `E_AUTH`** — the exact conflation P24 and P25 spent two phases chasing at the connect boundary,
> living one layer down in the data plane, entirely untested (§1.4). P26 pins it; it does not fix it,
> for the reason §7 gives.
>
> **Scope honesty.** This is real Docker. There is no permutation matrix here. P25's own
> justification for one — *"most permutations of who can connect"* — does not transfer to *"does a
> write work"*: a write either works or it does not, and running it under twelve config shapes buys
> nothing. What *is* worth crossing is **capability × permission posture** (P25 §3.2's own stated
> payoff), and that cross product is small: one or two scenarios per already-existing matrix row.
> Every Tier-1 addition below reuses a container that is already running and adds round trips, never
> a fixture.

---

## 0. Scope and non-scope

**In scope**: functional coverage for all nine adapter packages (`postgres`, `mysqlfamily` covering
mysql + mariadb, `clickhouse`, `sqlite`, `mongo`, `redis`, `kafka`, `sqs`, `s3`), split across
P25's two tiers; one shared scenario library under
`apps/kira-studio/internal/adapters/testsupport/`; the small harness additions §2.1 identifies.

**Out of scope, explicitly**:

- **Any change to an adapter's own behaviour.** This is a testing phase. §1.4's conflation finding
  and §3.5/§3.6's two pinned behaviours are *recorded and pinned*, not fixed — fixing an error
  mapper is a behaviour change with a UI-visible consequence (P24 §3 owns how a connection error
  renders), and it belongs in its own phase with its own before/after transcripts, exactly as P25
  §1 handled its own four.
- **`scripts/test-matrix.sh`, `package.json`, and `docs/pending-workflows/test-matrix.yml`.**
  Verified: the runner invokes each adapter's whole package (`go test … ./adapters/<kind>/...`), so
  new gated cases inside an existing `authmatrix_test.go` are picked up with no runner change at
  all. Saying this explicitly because "add a test tier, edit the runner" is the reflex, and here it
  is wrong.
- **A new fixture or a new container.** Every scenario below runs against a container an existing
  `Start<Kind>` already provides. The one exception is not a new container either: Kafka's SASL
  broker (`testsupport.StartKafkaSasl`, built by P25) is already started by
  `TestKafka_AuthMatrix` — §3.8 only needs a topic-creation helper that can reach it.
- **Anything under `apps/kira-studio/frontend/`.** No frontend file is touched.
- **A compat cross product.** `scripts/db-compat.sh` already runs the general tier against min/max
  server images. Crossing that with the functional matrix is a multiplicative cost for no new
  question, and P25's runner comment already declined the same thing for auth.
- **File-permission and IAM postures.** P25 §1.6 declined SQLite file modes (this sandbox runs as
  root) and P25 §2.3 measured, twice, that LocalStack does not enforce credentials at any
  configuration. Both declines carry forward unchanged; §3.9 is short *because of a measurement*,
  not because nobody looked.

---

## 1. Part 1 — what the tree actually has, read before deciding anything

### 1.1 Method

For each of the nine packages: read `caps.go` (what the adapter *claims*), read `adapter.go` against
`adapters/adapter.go`'s twelve-method contract (what it can actually be asked to do), read
`errors.go` (what a refusal is coded as), then enumerate every `func Test…` and `t.Run(…)` in that
package's `*_test.go` files and match them against the claim. The question throughout is not "is
there a test" but "is there a test for a capability this adapter's own `caps.go` advertises to the
UI".

### 1.2 The functional surfaces that exist — and the one that does not

`adapters.Adapter` (`adapters/adapter.go:33-83`) has twelve methods. The ones a functional test can
drive, and what gates each:

| Surface | Method | Gate | What it covers |
|---|---|---|---|
| Load / query | `Read`, `Count` | always present; shape from `Caps().DefaultPageKind` | paging, projection, filter, sort |
| Catalog | `Children`, `Describe`, `Definition` | `Describe`/`Definition` caps | tree enumeration, column/PK/FK/index metadata |
| Write / delete | `Preview`, `Mutate` | `Caps().Writable`, `CanInsert`/`CanUpdate`/`CanDelete` | the whole mutation path |
| Ad-hoc | `Execute` | `Caps().SQL` | **the only DDL surface in the entire app** |
| File | `DownloadObject` | `Caps().FileTransfer` | s3 only |

**There is no DDL method.** Nothing in the `Adapter` contract creates a table, schema, collection,
topic, queue or bucket. Verified by grep across every non-test adapter file: no `CreateTopics`, no
`CreateQueue`, no `CreateBucket`, no `createCollection` call exists anywhere in
`internal/adapters/`. So:

- For the five SQL-capable adapters (`postgres`, `mysql`, `mariadb`, `sqlite`, `clickhouse`), **DDL
  means `Execute` with a DDL statement**, and the only thing worth asserting about it is not "does
  the driver run `CREATE TABLE`" (it does; that is the driver's job, not this app's) but **does the
  object the DDL created become visible to `Children`/`Describe` on the same connection** — the
  catalog round trip. That is genuinely untested everywhere, and it is where an adapter's own
  catalog SQL, identifier quoting and DDL parsing meet real server output.
- For `mongo` and `redis`, `Caps().SQL` is true but neither has schema DDL: Mongo's console
  dispatches exactly ten CRUD shell methods (`model.MongoConsoleMethods`, `storage/model/console.go:16-27`
  — no `createCollection`, no `createIndex`, no `drop`), and Redis has no schema at all. Their DDL
  analogues are *implicit object creation* (§3.5, §3.6).
- For `kafka`, `sqs` and `s3`, `Caps().SQL` is false and there is no object-creation path. **They
  have no DDL story, and saying so is the correct answer** rather than inventing one by calling the
  fixture's own admin client "DDL".

### 1.3 The Tier-1 coverage audit, per adapter

Every row below was read from the named file, not inferred. ✓ = a dedicated test exists; **✗** = the
capability is declared true in `caps.go` and has no test; — = the capability is false, so nothing is
owed.

| Adapter | Read page | Filter (`ServerFilter`) | Projection | Count | Insert lands | Update lands | Delete lands | DDL→catalog | Read-only refusal |
|---|---|---|---|---|---|---|---|---|---|
| postgres | ✓ `:365`,`:385`,`:407` | ✓ `:518` | ✓ `:500` | ✓ `:537` | ✓ `:1015` (bulk) | ✓ `:672` | **✗** | **✗** | ✓ `:552`,`:582` |
| mysqlfamily | ✓ `:355`,`:370` | **✗** | **✗** | ✓ `:438` | **✗** | ✓ `:502` | **✗** | **✗** | ✓ `:727`,`:756` |
| clickhouse | ✓ `:244` | **✗** | **✗** | ✓ `:270` | ✓ `:307` | — | — | **✗** | ✓ `:352` |
| sqlite | ✓ `:231`,`:245`,`:313` | **✗** | **✗** | ✓ `:336` | **✗** | ✓ `:374` | **✗** | **✗** | ✓ `:436` |
| mongo | ✓ `:320`,`:366` | ✓ `:417` | ✓ `:393` | ✓ `:484` | ✓ `:671` | ✓ `:671` | ✓ `:671` | n/a (§1.2) | **✗** |
| redis | ✓ `:212`-`:434` | — | — | ✓ `:478` | ✓ `:497` | ✓ `:497` | ✓ `:497` | n/a | **✗** |
| kafka | ✓ `:422`,`:498` | — (its `Filter` is a timestamp seek, ✓ `:829`) | — | ✓ `:577` | ✓ `:716` | — | — | n/a | n/a (not `Writable`-gated per row) |
| sqs | ✓ `:230`,`:277` | — | — | ✓ `:328` | ✓ `:455` | — | ✓ `:455` | n/a | — |
| s3 | ✓ `:276`-`:319` | — | — | ✓ `:347` | ✓ `:587` | ✓ `:487` | ✓ `:555` | n/a | ✓ `:522` |

Line numbers are into that package's own primary `*_test.go`
(`postgres/postgres_test.go`, `mysqlfamily/mysqlfamily_test.go`, and so on).

**Two corrections to a reading that looks obvious and is wrong.** First: `postgres_test.go:564`,
`sqlite_test.go:446` and `mysqlfamily_test.go:737` each contain a `Kind: "delete"` op, which at a
glance looks like delete coverage. All three are *inside the read-only-refusal tests* — the plan is
built specifically so it will be refused, and the delete never runs. Second: `postgres_test.go:645`
is an insert op inside `TestPostgres_PreviewNeverExecutes`, which asserts it is **not** executed. So
the ✗ marks above are real. Likewise `mysqlfamily_test.go:580-581` does carry a `Filter`/`Projection`
pair, but incidentally, inside a mid-transaction cancellation test whose assertion is about
transaction state, not about the filter narrowing anything.

### 1.4 The cross-adapter finding: four adapters code an *authorization* failure as `E_AUTH`

Read directly from each `errors.go` at the base commit. The question is what an adapter returns when
a connection that authenticated perfectly is then refused a *specific operation* for lack of
privilege — the state every least-privilege real deployment is in.

| Adapter | Permission-denied code today | Where |
|---|---|---|
| postgres | `E_QUERY` — SQLSTATE `42501` is not in the auth switch (only `28P01`/`28000`) | `postgres/errors.go:32-37` |
| mysql / mariadb | `E_QUERY` — only errno `1045` maps to auth; `1142`/`1044` fall through | `mysqlfamily/errors.go:24-29` |
| sqlite | `E_UNSUPPORTED` for a read-only file (primary code 8); no principals exist | `sqlite/errors.go:44-45` |
| **clickhouse** | **`E_AUTH`** — `accessDenied` (497) and `databaseAccessDeny` (291) are in the auth arm | `clickhouse/errors.go:64-66` |
| **mongo** | **`E_AUTH`** — `CommandError` code **13 (`Unauthorized`)** shares a branch with 18 (`AuthenticationFailed`) | `mongo/errors.go:29-31` |
| **redis** | **`E_AUTH`** — `authPrefixRE` matches every `NOPERM`, key-pattern refusals included | `redis/errors.go:14` |
| **kafka** | **`E_AUTH`** — `TopicAuthorizationFailed`, `GroupAuthorizationFailed`, `ClusterAuthorizationFailed` share a branch with `SaslAuthenticationFailed` | `kafka/errors.go:56-58` |
| sqs / s3 | not exercisable against this fixture (P25 §2.3, measured twice with `ENFORCE_IAM=1`) | — |

Every one of the four is deliberate — each carries a comment describing the branch as "the two auth
command codes" or equivalent. None of the four is *wrong* in a narrow sense: a permission refusal is
an access-control failure. But the consequence at the UI is that a user with a correct password and
a missing `GRANT` is told their credentials are wrong, which is verbatim the symptom P24 §1 opened
with and P25 §1.2–§1.5 reproduced four more times at the connect boundary. **Nobody has looked one
step past `Connect()`, and there is no test anywhere that would notice.**

P25's own `redis/authmatrix_test.go:82-104` already found and recorded one instance of this while
implementing that phase's plan, and pinned current behaviour rather than asserting the plan's
not-yet-true claim. P26 generalizes that treatment to all four: **a scenario per affected adapter
that asserts the code the adapter produces today, with a comment naming it as a pinned conflation.**
When a later phase fixes an error mapper, four tests break on purpose, in four different packages,
each pointing at the line to change. That is the whole value, and it is worth more than a fifth
plan-doc paragraph asserting the problem exists.

### 1.5 What is deliberately *not* a gap

Stated so this phase does not pad itself:

- **s3 is the best-covered adapter in the repo** — 32 tests, including upload-from-disk, oversized
  bodies, delete-then-second-delete, and three `DownloadObject` cancellation shapes. §3.7 adds two
  scenarios and no Tier-1 test at all.
- **kafka's produce→browse round trip already exists** (`kafka_test.go:716`), along with
  partition fan-out, offset tokens, timestamp seeking and a transaction-marker gap case. §3.8's
  single addition is about *which broker* it runs against, not about the operation.
- **sqs's send→receive→delete round trip already exists** (`sqs_test.go:455`), receipt-handle
  failure included.
- **mongo's insert/update/delete round trip already exists** (`mongo_test.go:671`), with the
  `$document` sentinel and the zero-rows-deleted error case beside it.
- **redis has eight distinct read-shape tests** (hash/set/zset/list/stream/string-with-TTL, small
  and big) plus insert/update/delete. Its read surface needs nothing.
- **No adapter caches its catalog in a way DDL could stale.** `postgres/catalog.go:286`,
  `mysqlfamily/catalog.go:361` and `sqlite/catalog.go:507` each resolve fresh per read, by
  documented design; the only adapter-local cache is sqs's queue-URL map, which already has both a
  hit test and a `Disconnect`-clears test (`sqs_test.go:396`, `:424`). So the DDL→catalog scenarios
  in §3 are asserting a *real* round trip, not a cache-invalidation bug hunt.

---

## 2. Part 2 — how this attaches to P25's harness

### 2.1 What the harness needs: one function, and nothing else

Read from the real `testsupport/matrix.go` (127 lines) rather than from P25's plan prose. The
verdict:

- **`Case`, `Outcome`, `Principal`, `RunMatrix` need no change.** `RunMatrix:105-110` already runs
  `Then` correctly: after a successful `Connect`, for each scenario, skip when `Requires(a.Caps())`
  is false, else `t.Run(s.Name, …)` with the live adapter. Nothing about it was written for auth.
- **`Scenario` needs no field added.** The obvious objection is that a scenario needs the *path* to
  the object it operates on, and `Run(t, a, cfg)` gives it only the config. It does not need one:
  the path is captured in the closure of a **scenario constructor** —
  `testsupport.ReadFirstPage(path) Scenario` — so the adapter's own table supplies its own path
  shape and the shared body never has to know that Postgres has `database/schema/table` and Mongo
  has `database/collection`. This is the design that makes a shared library possible at all, and it
  is why P25's seam turns out to have been the right shape.
- **One genuine addition**, because Tier 1 must not be gated behind `KIRA_TEST_MATRIX` (P25 §3.3's
  own rule: a regression test for a real capability should read as one, not as a matrix row):

```go
// testsupport/matrix.go — the only addition this phase makes to the harness.
// RunScenarios applies the same Requires gate RunMatrix does, outside a matrix table, so one
// scenario body backs both tiers instead of being written twice.
func RunScenarios(t *testing.T, a adapters.Adapter, cfg model.ResolvedConnectionConfig, scenarios ...Scenario)
```

That is the whole infrastructure delta, plus §3.8's one fixture helper.

### 2.2 `testsupport/scenarios.go` — what is genuinely shareable, and what is not

The brief's real question. Answered by what the types actually allow:

**Shareable, because the assertion does not depend on the adapter's data model:**

| Scenario constructor | `Requires` | Body |
|---|---|---|
| `ReadFirstPage(path)` | none | `Read` returns a page with `Rows() > 0` — `page.Page` exposes `Rows()` (`page/builder.go:65-69`), so this works for tabular, document, key-value and stream pages alike |
| `ReadIsRefused(path, wantCode)` | none | `Read` fails with exactly `wantCode` |
| `CountMatchesRead(path)` | `c.ExactCount` | `Count` equals the row total a full read walks; auto-skips mongo and sqs |
| `FilterNarrowsResult(path, filter, wantRows)` | `c.ServerFilter` | auto-skips redis, kafka, sqs, s3 |
| `ProjectionLimitsColumns(path, cols)` | `c.Projection` | same skip set |
| `MutateSucceeds(plan, wantAffected)` | `c.Writable` | |
| `MutateIsRefused(plan, wantCode)` | `c.Writable` | **the phase's most valuable scenario** — §1.4's pin |
| `ExecuteIsRefused(path, statements, wantCode)` | `c.SQL` | |
| `DownloadRoundTrips(path)` | `c.FileTransfer` | s3 only, automatically |

**Not shareable, and forcing it would be the mistake:**

- **Anything that *builds* a `model.MutationRowOp`.** Every non-SQL adapter uses its own reserved
  sentinel — mongo's `$document` (`mongo/mutate.go:19`), redis's `_key`/`$value`
  (`redis/mutate.go:16-19`), s3's `_key`/`$file`, sqs's `$body` — while the SQL adapters use plain
  column names. There is no honest common constructor. **So every mutation scenario takes a
  pre-built `model.MutationPlan` as a parameter**: the *plan* is the adapter's, the *assertion* is
  shared. That single decision is what keeps the library from becoming a config DSL.
- **Read-back after a write.** The page shape differs by `DefaultPageKind`, and `spec.go` already
  has four different readers for it (`CellAt`, `DocBodyAt`, `KVPairs`, `StreamBodyAt`). Read-back
  assertions stay in the adapter's own file, where the right reader is already in scope.
- **Any SQL or filter text.** Dialect. It is a parameter, never a constant in the library.
- **The expected error code for a permission refusal.** §1.4: it is genuinely four different answers
  across the ten adapters. `MutateIsRefused` takes `wantCode` for exactly this reason, and each
  adapter's table states its own with a comment.

**What `Requires` can and cannot do, honestly.** It gates on a *capability flag*, which is a real
and sufficient gate for "should this operation be attempted at all". It cannot gate on dialect,
sentinel shape, or page kind — those come in as parameters. Stating the boundary here because a
`Requires`-only design would silently produce a suite that compiles, skips half its rows for the
wrong reason, and looks thorough.

### 2.3 The Tier-1 / Tier-2 rule for functional coverage

P25's split is by **cost**, and the same criterion resolves cleanly here into one rule:

> **Tier 1 gets one assertion per declared capability that has none today.** `AGENTS.md`'s
> adapter-conformance carve-out already says per-capability coverage belongs in
> `adapters/*/*_test.go` "even where it reads like a CRUD round-trip" — a capability the UI branches
> on and no test exercises is precisely what that carve-out is for. Cost: round trips on a container
> that is already running.
>
> **Tier 2 gets everything whose cost is a *principal* or a *posture*.** A scenario is Tier 2 when
> it needs a role created at runtime, a read-only connection, a scoped `options.bucket`, a
> fields-mode client config, or a second broker — i.e. the *capability × permission posture* cross
> product P25 §3.2 named as the payoff. Cost: a principal per case, which is what
> `KIRA_TEST_MATRIX` exists to keep out of `bun run test:go`.

Applied to §1.3's table, that yields **13 new Tier-1 tests** (most of them two-line filter or
projection assertions against an already-connected adapter) and **~24 Tier-2 scenarios** attached to
matrix rows that already exist. No new matrix rows are proposed anywhere — the rows are already
there; they connect and then stop.

### 2.4 Data isolation — the one real cost, and the rule that removes it

Every fixture is memoized per test binary (`testsupport/fixture.go`), so a scenario that mutates a
*seeded* object breaks a sibling test's assertion. This is not hypothetical:
`postgres_test.go:1021-1024` carries a cleanup whose comment records exactly that hazard for
`app.customers`.

**The rule: no P26 scenario touches a seeded object. Each creates its own scratch object, named for
the case, and drops it in `t.Cleanup`.** Applied to the SQL adapters this produces a pleasing
collapse — **the scratch table's own `CREATE TABLE` is the DDL test**. Every existing test that
needs a scratch table creates it over a *side* connection (`postgres_test.go:928`,
`mysqlfamily_test.go:662`, `sqlite_test.go:515`); routing that same setup through the adapter's own
`Execute` converts required fixture work into the exact assertion §1.3 marks missing, at no
additional cost. Where an object cannot be created through the adapter at all (a Kafka topic, an SQS
queue, an S3 bucket), the existing side-client helpers stay — and that asymmetry *is* §1.2's
finding, restated as a practice.

### 2.5 What this phase deliberately does not build

- **No "run every scenario against every adapter" driver.** P25 §3.3 already declined it, and
  §2.2's not-shareable list is the concrete reason: half the scenarios need a per-adapter plan or a
  per-dialect string, so a universal driver would be a parameter table pretending to be a driver.
- **No new tier, no second env var.** A functional scenario expensive enough to need one belongs in
  `Requires`, per P25 §3.2's own last bullet. Nothing proposed here is.
- **No mocks or fakes.** Real containers throughout, per `AGENTS.md`. The two existing in-package
  fakes (`s3/catalog_test.go`, `redis/catalog_test.go`) stay where they are.
- **No `Preview` coverage.** Every writable adapter already has a "preview never executes" test with
  byte-exact expected text; adding a second is the "when torn between two similar tests, delete"
  case.

---

## 3. Part 3 — the per-adapter plan

Ordered by **gap size against declared capability**, which is the honest risk/value ordering here:
an adapter that tells the UI it supports server-side filtering and has never had a filter run
against a real server is a larger risk than one whose write path is covered six ways. The SQL block
comes first for that reason, not by family.

Each subsection lists Tier-1 files/tests to add and Tier-2 scenarios to attach, with the existing
matrix row each attaches to. No test code — this is the plan.

### 3.1 clickhouse — the largest gap relative to what it claims

`clickhouse/caps.go` declares `Projection: true` and `ServerFilter: true`. `clickhouse_test.go`
exercises **neither**. It is also the only adapter whose catalog *parses DDL text* —
`catalog.go` reads `create_table_query` and `catalog_test.go` is 121 lines of unit tests over
hand-written `CREATE TABLE` strings — so a real DDL round trip is the only thing that would prove
that parser against ClickHouse's own re-rendered output rather than against strings this repo wrote.

**Tier 1** — new `t.Run` blocks inside `TestClickHouse` (`clickhouse/clickhouse_test.go`), beside
their neighbours:

1. `"read: filter narrows the result"` — a `Filter` against the seeded `regions`/`customers` table,
   asserting the narrowed `RowCount`. Two round trips.
2. `"read: projection limits the columns"` — assert `len(Columns)` and the column name.
3. `"execute: a DDL round trip is visible to the catalog"` — the phase's flagship test for this
   adapter, one scratch table:
   - `Execute` `CREATE TABLE kira_test.p26_scratch (id UInt32, name String) ENGINE = MergeTree ORDER BY id`
     → assert the returned page is a status page, not a row page (the existing
     `"row-returning vs command classification"` test at `:367` establishes the shape to assert against);
   - `Children(database kira_test)` now lists `p26_scratch`;
   - `Describe` returns both columns, no primary key, and the sparse primary index — the same
     assertion `:146` makes against a *seeded* table, now against one whose DDL this test wrote,
     which is what closes the `catalog.go` parser loop;
   - `Execute` `ALTER TABLE … ADD COLUMN note String` → `Describe` shows three columns;
   - `Execute` `DROP TABLE …` → `Children` no longer lists it;
   - `t.Cleanup` issues `DROP TABLE IF EXISTS` over `testsupport.AdminStatements`, so a mid-test
     failure cannot leak a table into a sibling test's tree assertion (`:114`'s tree enumeration
     asserts an exact child set).

No insert/update/delete additions: `CanUpdate`/`CanDelete` are false by design and already asserted
as `E_UNSUPPORTED` (`:324`), and insert-lands exists (`:307`).

**Tier 2** — scenarios attached in `clickhouse/authmatrix_test.go`. The fixture already seeds three
principals (`kira_admin`, `kira`, `kira_ro`), so no new `Principal` is needed:

| Attach to existing row | Scenario | Why |
|---|---|---|
| `kira_ro` | `ReadFirstPage` | the read-only principal's reads must work; `ReadOnlyConfig` exists and only the write tests use it today |
| `kira_ro` | `MutateIsRefused(plan, adapters.CodeAuth)` | **§1.4's pin for clickhouse, corrected against a real container (implementer finding).** This row's own draft expected ClickHouse's readonlyCode/tableIsReadOnly (164/242 → `E_UNSUPPORTED`, `errors.go:60`) here. Measured instead: a missing `INSERT` grant is a plain authorization refusal — "Not enough privileges … (ACCESS_DENIED)", numeric code 497 — which `errors.go:64` maps to `E_AUTH`, the same code a wrong password produces. There is no "correct mapping" case for a missing-grant `Mutate`/`Execute` refusal on this adapter; both are the conflation |
| `kira_ro` | `ExecuteIsRefused(ddl, adapters.CodeAuth)` | same measured mapping, DDL path |
| `kira_admin, database unset` | `ReadFirstPage` on a `system` table | proves the admin principal reaches what the scoped one cannot — the posture half of the cross product |

**Implementer finding, not planned:** the separate "`kira`, a `system` table it has `SELECT` but not
`SHOW USERS` on" row this section originally planned does not exist as a refusal — measured against
a real container, `kira`'s plain `GRANT SELECT ON system.*` (`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`
is set) is sufficient to read `system.users` on this image (26.3), so that assumed extra-privilege
gate was wrong. Dropped in favor of the `kira_ro` rows above, which are a real, exercised instance of
the same conflation. Also: `kira`'s own grants needed `CREATE TABLE`/`DROP TABLE` added (ClickHouse's
`ALTER` privilege does not itself cover object creation/deletion) for §3.1(3)'s Tier-1 DDL round trip
to run at all — `testsupport/clickhouse.go`'s grants now read `SELECT, INSERT, ALTER, CREATE TABLE,
DROP TABLE`, up from `SELECT, INSERT, ALTER DELETE`.

### 3.2 mysqlfamily — the same two gaps, doubled

`mysql/caps.go` and `mariadb/caps.go` both declare `Projection: true` and `ServerFilter: true`;
`mysqlfamily_test.go` has no dedicated test for either (the `:580-581` occurrence is incidental,
§1.3). No real insert lands anywhere, and no real delete. Everything below runs through
`runFamilySuite`, so each item is ×2 engines at no extra authoring cost — the reason this adapter
ranks second despite Postgres being the flagship.

**Tier 1** — new `t.Run` blocks in `runFamilySuite` (`mysqlfamily/mysqlfamily_test.go`):

1. `"read: filter and sort"` — mirrors `postgres_test.go:518`'s shape.
2. `"read: projection"` — mirrors `postgres_test.go:500`.
3. `"execute: a DDL round trip is visible to the catalog"` — `CREATE TABLE kira_test.p26_scratch
   (id INT PRIMARY KEY, name VARCHAR(64))` via `Execute` → `Children(database)` → `Describe`
   (columns + PK) → `ALTER TABLE … ADD COLUMN` → `Describe` → `DROP TABLE`. Also assert `Definition`
   on the scratch table returns a non-empty `CREATE TABLE`: MySQL and MariaDB render `SHOW CREATE
   TABLE` differently, and this is the one place the two engines' `Definition` output is compared
   against DDL the test itself wrote (`:329` asserts it only against a seeded table).
4. `"mutate: insert then delete round-trips"` — into the scratch table from (3), so no seeded table
   is touched: insert two rows, `Count` == 2, delete one by PK, `Count` == 1, `Read` confirms the
   surviving key. Closes both ✗ marks in one test.
5. **Extend, do not add:** append a `CREATE TABLE` attempt to the existing escape-attempt list in
   `"read-only connection execute cannot escape read-only transaction"` (`:756`), and assert the
   table does not exist afterwards. Today that test only proves a `DELETE` is refused; a DDL
   statement takes a different server-side path and is untested.

**Tier 2** — in `mysqlfamily/authmatrix_test.go`. The matrix already creates a
`GRANT SELECT ON kira_test.*`-only user (P25 §2.5 row 5), which is the ideal least-privilege
principal and currently only proves it can connect:

| Attach to existing row | Scenario |
|---|---|
| `SELECT`-only user | `ReadFirstPage`, `FilterNarrowsResult` — a read-only grant must still read and filter |
| `SELECT`-only user | `MutateIsRefused(plan, adapters.CodeQuery)` — errno 1142 is not in the auth switch (`errors.go:24-29`), so this asserts the *correct* behaviour, and asserting it is what stops a future "helpful" widening of that switch from silently reintroducing §1.4's conflation here |
| `SELECT`-only user | `ExecuteIsRefused(ddl, adapters.CodeQuery)` |
| `root, database unset` | `ReadFirstPage` against a `kira_analytics` table — the cross-database read the scoped user cannot reach; `Children(root)` already asserts visibility, nothing asserts a read |

### 3.3 sqlite — the same gaps, and the cheapest suite in the repo to run

`sqlite/caps.go` declares `ServerFilter: true` and `Projection: true`; there is **no `Filter` test at
all** in `sqlite_test.go`, and projection appears only inside a value-codec test. SQLite needs no
Docker and no daemon (`StartSqlite` has no availability gate), so its coverage-per-second is the
best available — which is why it ranks above Postgres here despite being a smaller adapter.

**Tier 1** — new `t.Run` blocks in `TestSqlite`:

1. `"read: filter"`, 2. `"read: projection"` — as above.
3. `"execute: a DDL round trip is visible to the catalog"` — `CREATE TABLE p26_scratch (id INTEGER
   PRIMARY KEY, name TEXT)` → `Children` → `Describe` → `ALTER TABLE … ADD COLUMN` → `CREATE INDEX
   p26_scratch_name ON p26_scratch(name)` → `Describe` shows the index → `DROP TABLE`.
   **One implementer trap, from this package's own suite:** `sqlite/query.go` rejects a smuggled
   second statement in one string (`sqlite_test.go:494`), so each DDL statement must be a separate
   element of `ConsoleRequest.Statements`, never one semicolon-joined string.
   The `CREATE INDEX` step is worth taking *here and nowhere else*: SQLite is the engine where
   `Describe`'s index list is cheapest to assert, and the round trip proves `catalog.go`'s index
   read against an index the test just declared.
4. `"mutate: insert then delete round-trips"` — into the scratch table.
5. `"read-only connection cannot run DDL, and creates no sidecar"` — a read-only connection's DSN
   carries `mode=ro` (`client.go:73-78`). Assert `Execute("CREATE TABLE …")` is refused, that the
   table does not exist afterwards, **and that no `-wal`/`-shm` sidecar appeared** — the file-level
   property `:742` already asserts for reads, extended to a refused write, which is the honest
   SQLite-specific case and the one a `mode=ro` regression would break first.

**Tier 2** — `sqlite/authmatrix_test.go`. SQLite has no principals, so its Tier-2 axis stays path
handling (P25 §2.9) and gains only what a *posture* buys:

| Attach to existing row | Scenario |
|---|---|
| `the seeded file, read-only` | `ReadFirstPage` (a read-only connection still reads), `MutateIsRefused(plan, adapters.CodeUnsupported)`, `ExecuteIsRefused(ddl, adapters.CodeUnsupported)` — `sqlite/errors.go:44-45` maps primary code 8 to `E_UNSUPPORTED`, and nothing exercises it from a real refusal |

One further row is worth adding and is cheap: **a second connection opened on the same file sees a
table the first connection's `Execute` created.** SQLite is the only engine where "two connections,
one file" is an ordinary user situation (two windows on the same database), and it is the only
adapter for which the catalog round trip is also a *file* round trip. One case, two adapters, no
container.

### 3.4 postgres — best-covered SQL adapter; gains DDL and the write-refusal cross product

Postgres has filter, projection, keyset paging both directions, a nullable-column fallback, count,
binary round trips, a bulk insert plan, transaction-cancellation and read-only escape attempts. Its
gaps are narrow and specific.

**Tier 1** — new functions in `postgres/postgres_test.go`:

1. `TestPostgres_ExecuteDDLRoundTrip` — `CREATE TABLE app.p26_scratch (id serial PRIMARY KEY, name
   text, region_id int)` via `Execute` → `Children(schema app)` lists it → `Describe` returns the
   three columns and the PK → `ALTER TABLE … ADD COLUMN note text` → `Describe` returns four →
   `DROP TABLE` → `Children` no longer lists it. `t.Cleanup` drops over a `pgx` side connection,
   because `TestPostgres_TreeEnumeration` (`:175`) asserts a child set that a leaked table would
   break.
2. `TestPostgres_MutateDeleteRemovesTheRow` — against the scratch table from (1), or its own:
   insert three rows, `Count` == 3, `Mutate` delete by PK, `Count` == 2, `Read` confirms the key is
   gone. The only ✗ in Postgres's row of §1.3's table.
3. **Extend, do not add:** append a `CREATE TABLE` attempt to
   `TestPostgres_ReadOnlyConnectionExecuteCannotEscapeReadOnlyTransaction`'s `attempts` list
   (`:604-606`) and assert non-existence afterwards. One list element, and it covers the DDL path
   that a `DELETE` does not.

**Tier 2** — in `postgres/authmatrix_test.go`. The matrix already builds a least-privilege role with
`CONNECT` + `USAGE` + `SELECT` and no write grant, and row 3 already carries one
`Children(root)` scenario — the file to extend, not to create:

| Attach to existing row | Scenario | Why |
|---|---|---|
| least-privilege role, `database=kira_test` | `ReadFirstPage`, `FilterNarrowsResult`, `CountMatchesRead` | the role has `SELECT`; reads must work under it, and nothing proves that today |
| least-privilege role | `MutateIsRefused(plan, adapters.CodeQuery)` | SQLSTATE 42501 → `E_QUERY` (`errors.go:32-37`). **The single most valuable new assertion in the phase**: it pins that a missing `GRANT` does *not* read as a wrong password, which is the property P24 and P25 were both about, asserted for the first time past `Connect()` |
| least-privilege role | `ExecuteIsRefused(ddl, adapters.CodeQuery)` | the DDL half of the same |

**Implementer finding, not planned:** the fifth row this section originally planned — superuser,
`database` unset, `ReadIsRefused(kira_test-table-path, adapters.CodeQuery)` — does not hold. Measured
against a real container: `postgres/adapter.go`'s `Read` opens its own per-database connection keyed
off the request path's own `database` segment (`client.go`'s `ConnSet`, an 8-entry LRU keyed by
`(connection, database)`), reusing the same credentials Connect() was given — it does not stay pinned
to whatever database the initial probe landed on. A superuser has full rights on `kira_test`
regardless, so this read *succeeds*, the same way `least-privilege role, a database it has no CONNECT
on` (row 6, existing) already proves the failure path for a role that genuinely lacks access. The
"read against a table outside the fallback database" consequence P24/P25 cared about only bites a
role with restricted database-level access, which row 6 already covers; a superuser has none to hit.
Dropped rather than asserted incorrectly.

### 3.5 mongo — read-only is entirely unasserted, and its DDL analogue is implicit creation

Mongo's read surface is well covered (keyset, offset+sort, projection, filter, EJSON byte stability,
field-order preservation) and so is its mutation surface. Two real gaps.

**Tier 1** — new functions in `mongo/mongo_test.go`:

1. `TestMongo_ReadOnlyConnectionCannotWrite` — `mongo/adapter.go:60` sets `a.readOnly` from the
   config and **nothing anywhere asserts it**. Every other writable adapter has this test
   (postgres `:552`, mysqlfamily `:727`, clickhouse `:352`, sqlite `:436`, s3 `:522`); Mongo and
   Redis are the two that do not. Assert `Preview` and `Mutate` return `E_UNSUPPORTED` and the
   document is unchanged.
2. `TestMongo_Mutate_InsertCreatesTheCollectionAndItAppearsInTheTree` — Mongo's whole DDL analogue
   (§1.2): `Mutate` an insert into a collection name that does not exist, then `Children(database)`
   lists it, then `Read` returns the document, then `Mutate` delete. Cleanup drops the collection
   over the fixture's `RootURI` client, because `TestMongo_Children_ListCollections` (`:195`)
   asserts a child set. This is the closest thing Mongo has to "does DDL reach the catalog", and it
   exercises `catalog.go:42`'s `ListCollectionSpecifications` against an object created in the same
   test.

**Tier 2** — in `mongo/authmatrix_test.go`, which already creates *two* purpose-built principals:

| Attach to existing row | Scenario | Why |
|---|---|---|
| read-only user scoped to `kira_test` | `ReadFirstPage`, `FilterNarrowsResult` | the `read` role must read and filter |
| read-only user | `MutateIsRefused(plan, adapters.CodeAuth)` | **§1.4's pin for mongo.** `CommandError` code 13 (`Unauthorized`) shares a branch with 18 (`AuthenticationFailed`) at `errors.go:29-31`, so a missing role reads as a wrong password today. Pinned with a comment naming it, exactly as P25's redis matrix pinned its own NOPERM equivalent |
| user in `admin` + `options.authSource=admin` | `MutateSucceeds(plan, 1)` then a read-back in the adapter's own file | P25 §1.2's fix is asserted only for the handshake. This carries it one step further: the fixed fields-mode connection can actually *write* as the principal it authenticated |

`CountMatchesRead` is deliberately not attached: `mongo/caps.go` sets `ExactCount: false`, so its
`Requires` would skip it anyway — noted so a reader does not read the omission as an oversight.

### 3.6 redis — the per-command read-only gate, and a cross-surface round trip

Redis has no `Projection`, no `ServerFilter`, no `Describe`, no `Definition` and no schema, so
**filter, projection and DDL simply do not apply** — the honest answer, and the reason its section
is short rather than padded with a filter test against a store that cannot filter.

**Tier 1** — new functions in `redis/redis_test.go`:

1. `TestRedis_ReadOnlyConnection_ConsoleAllowsReadsRefusesWrites` — Redis is the **only** adapter
   whose read-only enforcement is per-command, resolved against the server's own `COMMAND` table
   (`client.go:173-190`, `console.go:132`). That mechanism is genuinely non-obvious — it is exactly
   the "decision structure worth guarding" `AGENTS.md`'s test bar describes — and it has no
   container-backed test at all (`console_test.go` is 70 lines of tokenizer unit tests). Assert that
   on a read-only connection `Execute("GET …")` succeeds, `Execute("SET …")` is refused, and the
   value is unchanged afterwards.
2. `TestRedis_ConsoleCreatedKeyAppearsInTreeAndReads` — Redis's implicit-creation analogue and the
   only place its four surfaces are asserted to agree: `Execute("HSET p26:h a 1")` →
   `Children(db0)` lists `p26:h` → `Read` renders it as a `KeyValuePage` carrying that field →
   `Mutate` delete → `Children` no longer lists it. `t.Cleanup` `DEL`s over a side client, since
   `TestRedis_Children_RootNamespacesAndKeys` (`:156`) asserts a namespace set.

**Tier 2** — in `redis/authmatrix_test.go`:

| Attach to existing row | Scenario |
|---|---|
| `~* +@all -@dangerous` | `ReadFirstPage` on a seeded key, `MutateSucceeds(plan, 1)` — this ACL is P25 §1.3's headline "most commonly recommended application ACL", and P25 proved only that it can *connect* |
| ACL user with no `~*` keyspace grant | `MutateIsRefused(plan, adapters.CodeAuth)` — the **write** half of the conflation that row's existing scenario already pins for reads (`authmatrix_test.go:82-104`). Same comment, same reason: pinned as current behaviour so a future `errors.go` fix breaks both halves together |

**Named and explicitly not fixed:** `redis/errors.go:14`'s `authPrefixRE` matching every `NOPERM` is
§1.4's redis instance. P25 recorded it and left it; P26 pins its second half and leaves it for the
same reason (§7).

### 3.7 s3 — near-complete; only the postures are untested

Nothing to add to Tier 1. `s3_test.go` covers reads at root/nested/sibling prefixes, exact count,
oversized-body exclusion, update-preserves-attributes, upload-from-disk, delete-then-second-delete,
read-only refusal, and four `DownloadObject` shapes including two cancellation paths. Saying so
plainly rather than manufacturing a thirty-third test.

**Tier 2** only — in `s3/authmatrix_test.go`, attached to rows P25 already built:

| Attach to existing row | Scenario | Why |
|---|---|---|
| `options.bucket = main-bucket` | `ReadFirstPage`, `CountMatchesRead`, `DownloadRoundTrips` | P25 §1.5d established this is the code path written specifically for a single-bucket IAM policy — the least-privilege shape — and asserted only `Children(root)` on it. Its `Read`, `Count` and download are untested under the scoped posture, and this is the s3-only instance of the capability × posture cross product |
| fields mode, `region` set | `ReadFirstPage` | **every functional s3 test today runs URI mode.** Fields mode reaches `Connect` and stops (`testsupport/s3.go`'s config is URI-only), so `awscfg`'s fields branch has never served a data-plane request |

No DDL: bucket creation is not an adapter capability (§1.2). No auth-posture rows: LocalStack does
not enforce IAM (P25 §2.3, measured).

### 3.8 kafka — the produce/consume path has never run over an authenticated connection

`kafka_test.go` is thorough on the PLAINTEXT broker: partition fan-out, offset-token paging,
timestamp seeking, empty topics, mid-browse cancellation, a transaction-marker gap, and a
produce→browse round trip. Filter/projection/DDL do not apply (`ServerFilter: false`,
`Projection: false`, `SQL: false`); `CanUpdate`/`CanDelete` are permanently false and already
asserted `E_UNSUPPORTED` (`:600`).

The one real gap is not an operation, it is a **broker**: P25 built `testsupport.StartKafkaSasl` and
used it for connect assertions only, so no produce or consume has ever run over a SASL connection —
where `franz-go` re-authenticates on new connections and the produce path opens its own.

**Tier 1**: nothing.

**Tier 2** — in `kafka/authmatrix_test.go`:

| Attach to existing row | Scenario |
|---|---|
| SASL broker, correct `kira`/`kira` | a produce-then-consume scenario against a per-case scratch topic — `MutateSucceeds(producePlan, 1)` then a read-back in the adapter's own file (`StreamBodyAt`), mirroring `TestKafka_Mutate_ProduceThenBrowse`'s assertions against the authenticated broker |
| SASL broker, correct credentials | `ReadIsRefused(nonexistent-topic, adapters.CodeQuery)` — pins that an unknown topic stays `E_QUERY` rather than being swept into `E_AUTH` by the authenticated path (`errors.go:61-62` is the branch this protects) |

**One concrete `testsupport` change this needs**, and the only fixture work in the phase:
`testsupport.CreateTopic(t, f *KafkaFixture, name)` (`testsupport/kafka.go:177`) takes the PLAINTEXT
fixture's concrete type and reaches its `Admin` field, so it cannot create a topic on the SASL
broker. Generalize it — either an interface with an `Admin() *kadm.Client` accessor, or a sibling
`CreateTopicSasl(t, f *KafkaSaslFixture, name)`. Prefer the sibling: two small functions read better
than an interface introduced for two implementations, and `KafkaSaslFixture` already exists as its
own type.

### 3.9 sqs — the least to add, and the reason is a measurement

`sqs_test.go` already covers polling, repeated small polls seeing every message, empty and
nonexistent queues, approximate count, the queue-URL cache and its clearing, and a
send→receive→delete round trip with a receipt-handle failure case. Filter/projection/DDL do not
apply. `CanUpdate` is false by design (a delivered message cannot be edited) and already asserted.

And the posture axis that gives every other adapter its Tier-2 content is **unavailable here, for a
reason P25 measured rather than assumed**: LocalStack does not enforce credentials at any
configuration this fixture can drive, including `ENFORCE_IAM=1` (P25 §2.3's two transcripts). So
there is no least-privilege principal to cross anything with.

**Tier 1**: nothing.

**Tier 2** — one scenario, for the same reason as s3's second row:

| Attach to existing row | Scenario |
|---|---|
| fields mode, `region` set | a send-then-receive scenario against a per-case scratch queue — **every functional SQS test today runs URI mode** (`testsupport/sqs.go`'s config is URI-only), so `awscfg`'s fields branch has never served a data-plane request for this adapter either |

This adapter getting one scenario is the correct outcome, not a gap being left open quietly.

---

## 4. The whole diff surface

**New files (1):**

| File | Contents |
|---|---|
| `apps/kira-studio/internal/adapters/testsupport/scenarios.go` | §2.2's nine shared scenario constructors, each returning a `testsupport.Scenario` with its `Requires` gate |

**Changed files (20):**

| File | Change |
|---|---|
| `testsupport/matrix.go` | add `RunScenarios` (§2.1). `Case`/`Scenario`/`Outcome`/`Principal`/`RunMatrix` untouched |
| `testsupport/kafka_sasl.go` | add `CreateTopicSasl` (§3.8) |
| `clickhouse/clickhouse_test.go` | 3 new `t.Run` blocks (§3.1) |
| `clickhouse/authmatrix_test.go` | 5 scenarios on 3 existing rows |
| `mysqlfamily/mysqlfamily_test.go` | 4 new `t.Run` blocks + 1 extended attempts list (§3.2) |
| `mysqlfamily/authmatrix_test.go` | 4 scenarios on 2 existing rows |
| `sqlite/sqlite_test.go` | 5 new `t.Run` blocks (§3.3) |
| `sqlite/authmatrix_test.go` | 3 scenarios on 1 existing row, plus 1 new second-connection row |
| `postgres/postgres_test.go` | 2 new funcs + 1 extended attempts list (§3.4) |
| `postgres/authmatrix_test.go` | 5 scenarios on 2 existing rows |
| `mongo/mongo_test.go` | 2 new funcs (§3.5) |
| `mongo/authmatrix_test.go` | 4 scenarios on 3 existing rows |
| `redis/redis_test.go` | 2 new funcs (§3.6) |
| `redis/authmatrix_test.go` | 3 scenarios on 2 existing rows |
| `s3/authmatrix_test.go` | 4 scenarios on 2 existing rows |
| `kafka/authmatrix_test.go` | 2 scenarios on 1 existing row |
| `sqs/authmatrix_test.go` | 1 scenario on 1 existing row |
| `AGENTS.md` | its two-tier bullet ends `"…for new functional coverage (load/write/delete/filter/DDL, per adapter, P26) rather than building a parallel mechanism"` — a forward reference that is stale once this lands. Drop the `P26` pointer, keep the rule |
| `docs/ARCHITECTURE.md` | its Testing section (`:1008`) enumerates the suites and does **not** mention the two-tier split or `KIRA_TEST_MATRIX` at all — P25 documented it in `AGENTS.md` only. One short paragraph, since ARCHITECTURE.md is the authoritative "what suites exist" doc and the complete tier stops being a footnote once it carries functional coverage |

**Explicitly unchanged, verified:** `scripts/test-matrix.sh` (runs whole packages),
`package.json`, `docs/pending-workflows/test-matrix.yml`, `.github/workflows/ci.yml`, every
`caps.go`, every adapter source file.

---

## 5. Implementation order

Per `AGENTS.md`: one sequential subagent for the whole phase, implement first and verify once at the
end. The per-adapter work *is* genuinely independent, but the shared library is a common dependency
and the phase is small enough that parallelism would cost more in context-carrying than it saves.

1. **`testsupport/scenarios.go` + `RunScenarios`** — §2.2's constructors and §2.1's one helper.
   Nothing compiles against them yet; land them together.
2. **`CreateTopicSasl`** (§3.8) — the only fixture work.
3. **The four SQL adapters, in §3's order**: clickhouse, mysqlfamily, sqlite, postgres. Each is one
   commit covering both tiers for that adapter, so a bisect lands on one adapter.
4. **mongo, redis** — each one commit, both tiers.
5. **s3, kafka, sqs** — Tier-2 only; one commit together is fine, they share no code.
6. **The two doc edits** (`AGENTS.md`, `docs/ARCHITECTURE.md`), last, so they describe what actually
   landed.
7. **Verify once** — §6.

One thing for the implementer to expect, from §1.4: **three Tier-2 scenarios are written to assert a
behaviour this document calls a conflation** (clickhouse `E_AUTH`, mongo `E_AUTH`, redis `E_AUTH`).
If any of them turns out to produce a different code against a real container, that is a *finding*,
not a test to bend — record it in this document the way P25's implementer recorded two deviations
directly in `redis/authmatrix_test.go`'s own comments, and assert what the server actually does.

---

## 6. Verification

Per `AGENTS.md`'s implement-then-test-once rule.

1. `go build ./apps/kira-studio/internal/...` and `go vet ./apps/kira-studio/internal/...` — the
   env-gate design (P25 §2.2) means every matrix file stays compiled and vetted on an ordinary run,
   so this catches a scenario that drifted against an adapter signature.
2. `bun run test:go` — must pass, and **its wall clock must be unchanged within noise**. This is the
   phase's own guard rail: §2.3's Tier-1 additions are round trips on containers that are already
   running, so a materially slower general suite means a scenario landed in the wrong tier or a
   scratch object is being created per subtest instead of per test. Record the before/after
   duration in the phase's closing commit message — it is the one number worth measuring here,
   because it is the one that decides whether the tier split held.
3. `KIRA_TEST_MATRIX=1 sh scripts/test-matrix.sh --mirror` — the full complete tier, all nine rows.
   `--mirror` per `AGENTS.md`'s Docker section; the runner needs no flag for the new scenarios.
4. Spot-check the skip logic once: `go test -run AuthMatrix -v` on one package **without** the env
   var must skip before any container starts, and `-count=1` must be used for every gated run
   (`scripts/test-matrix.sh` already passes it, with db-compat.sh's own documented reason).
5. `bun run lint` / `typecheck` / `build` — untouched by this phase (no frontend file), run to
   confirm exactly that.

---

## 7. What this phase deliberately does not do

- **It does not fix §1.4's conflation in any of the four adapters.** Four `errors.go` files map an
  authorization refusal to `E_AUTH`, each deliberately. Changing that is a behaviour change whose
  consequence is user-visible (P24 §3 owns how a connection error renders, and P24 §1.2's whole
  argument was that an incorrectly-coded error tells the user the wrong thing) — it needs its own
  phase, its own before/after transcripts against real least-privilege principals per engine, and a
  decision about whether the closed `ErrorCode` set needs a distinct code for "authenticated but not
  authorized" at all. P26's contribution is that after it lands, **four tests in four packages break
  the moment someone changes one of those mappers**, which is worth more than a fix guessed at from
  a testing phase.
- **It does not add an `E_PERMISSION` (or similar) code.** That is the same decision as above, one
  layer further; it would touch `adapters/errors.go`, every adapter's mapper, the renderer's error
  branching and the shared TypeScript mirror.
- **It does not build a functional permutation matrix.** The brief's own warning, and the concrete
  reason is §2.3: a write either works or it does not. The dimension worth crossing is permission
  posture, and every posture that exists is already a matrix row.
- **It does not test DDL for its own sake.** No `CREATE VIEW`, no partitioning, no constraint
  matrix, no type-coverage sweep. DDL appears only where it answers a question the app itself has —
  does a created object reach `Children`/`Describe`, and is DDL refused where writes are refused.
- **It does not touch `redis/errors.go`'s `authPrefixRE`, `mongo/errors.go`'s code-13 branch,
  `clickhouse/errors.go`'s 497/291 arm, or `kafka/errors.go`'s three authorization codes.** Named
  four times because each is a live temptation while writing the very test that pins it.
- **It does not add coverage for `sqs`/`s3` auth postures**, for the reason P25 measured (§0).
- **It does not re-run the `db-compat` min/max axis against the new scenarios** (§0).

---

## 8. Sources

**Read directly from source at this phase's base commit `f4a81d6`** (`docs: fix the stale SlickGrid
entry…`, branch `claude/feature-v1-1-p5-onwards-2isfzt`), no claim below is from prose:

- `internal/adapters/adapter.go` (the twelve-method contract, §1.2), `internal/adapters/caps.go`
  and `internal/adapters/errors.go` (the closed `ErrorCode` set).
- All ten `caps.go` files (`postgres`, `mysql`, `mariadb`, `sqlite`, `clickhouse`, `mongo`, `redis`,
  `kafka`, `sqs`, `s3`) — §1.3's "declared true" column.
- All nine `errors.go` files plus `awscfg/errors.go` — §1.4's table, the phase's central finding.
- `internal/adapters/testsupport/matrix.go` in full (§2.1's verdict that the harness needs one
  function), plus `fixture.go`, `spec.go`, and every `Start<Kind>`/fixture struct in
  `postgres.go`, `mysql.go`, `mariadb.go`, `clickhouse.go`, `mongo.go`, `redis.go`, `kafka.go`,
  `kafka_sasl.go`, `sqs.go`, `s3.go`, `sqlite.go` — for which handles §3's scenarios can reach.
- All nine `authmatrix_test.go` files — every "attach to existing row" in §3 names a row that is
  really there; §3.6's and §3.1's pins follow the treatment `redis/authmatrix_test.go:56-71` and
  `:82-104` already established for two P25 deviations.
- Every primary `*_test.go` (`postgres_test.go` 1133 lines, `kafka_test.go` 996, `mongo_test.go`
  948, `mysqlfamily_test.go` 916, `s3_test.go` 805, `sqlite_test.go` 785, `redis_test.go` 689,
  `clickhouse_test.go` 537, `sqs_test.go` 523) — §1.3's table is an enumeration of their
  `func Test…`/`t.Run` sets matched against the caps files, including the two corrections §1.3 names.
- `internal/adapters/*/mutate.go` (the four sentinel vocabularies, §2.2's not-shareable list),
  `mongo/catalog.go`, `sqs/adapter.go`, `postgres/catalog.go`, `mysqlfamily/catalog.go`,
  `sqlite/catalog.go` (§1.5's no-stale-cache check), `redis/console.go` and `redis/client.go`
  (§3.6's per-command read-only gate), `sqlite/query.go`'s smuggled-statement guard (§3.3's trap).
- `internal/storage/model/{console,mutations,resolvedconnection}.go`, `internal/page/builder.go`
  (`Page.Rows()`, which is what makes `ReadFirstPage` shareable across four page kinds).
- `scripts/test-matrix.sh`, `package.json`, `docs/pending-workflows/test-matrix.yml`,
  `.github/workflows/` — §0's "unchanged, verified".

**In-repo documents:** `docs/v1.1/plans/P25-connection-auth-test-matrix.md` in full — §3's harness
design is the thing this phase builds on, and §3.4's capability survey is the input to every
`Requires` gate here; §2.3's measured LocalStack decline and §1.6's declined SQLite file modes carry
forward unchanged rather than being re-litigated.
`docs/v1.1/plans/P24-connection-auth-error-display.md` — §1's method (a purpose-created
least-privilege principal, because a fixture's own admin credentials hide this entire bug class) is
why §1.4 is a source read rather than a container run, and why §3's Tier-2 scenarios hang off
least-privilege rows specifically. `docs/v1.1/plans/P16-db-compat-suite.md` — the on-demand runner
whose shape `scripts/test-matrix.sh` already follows and which §0 declines to cross with.
`AGENTS.md` — the adapter-conformance carve-out (§2.3's Tier-1 rule is an application of it), the
two-tier convention P25 recorded there, the measure-with-purpose rule (§6 step 2 is the one
measurement that would change a decision), the implement-then-test-once rule (§5, §6), and the
comments rule. `docs/ARCHITECTURE.md` — its Testing section, read to confirm §4's last row (the
two-tier split is absent from it).

**Not measured, and so not claimed:** no container was started for this plan. Every §1 statement is
a source read or a test-name enumeration, both of which are verifiable by reading the same files;
§6's wall-clock guard rail is deliberately framed as a measurement the *implementer* takes, at the
point where it can actually change a decision, rather than one this document asserts in advance.
