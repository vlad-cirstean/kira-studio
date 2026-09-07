# P27 — making the test suite a lot faster

> **What this phase is.** `docs/v1.2/SPEC.md`'s P27 row, in the user's own words: *"add one more
> phase to improve the speed of the tests by a lot."*
>
> **Base commit.** Measured against `0be9f3e` (branch `claude/feature-v1-2`, "fix(datagrip): show
> the import report instead of discarding it"), in a dedicated worktree at `/tmp/claude-0/p27-plan`.
> Every `file:line` citation below points at that commit.
>
> **Measurement environment.** A Claude Code Linux container: **4 logical cores** (`nproc`), 15 GiB
> RAM, `dockerd` already running, and **every container image already pulled and tagged locally**
> (`docker images` listed all nine: `postgres:17-alpine`, `mysql:8.4`, `mariadb:11.4`,
> `clickhouse/clickhouse-server:26.3`, `confluentinc/cp-kafka:8.0.7`, `localstack/localstack:4`,
> `mongo:8.3`, `redis:8.10`, `testcontainers/ryuk:0.14.0`). **Image pull is therefore ≈ 0 in every
> number below** — this document measures a warm-image machine, which is what the normal dev loop
> is; a genuinely first-run pull is a one-off cost no configuration change can remove.
>
> **Nothing here weakens coverage.** Not one test is deleted, skipped, gated, or loosened. Two
> assertions actually get *stronger* footing (§2 D4): `budgets.spec.ts` and `perf.spec.ts` stop
> competing with three other browsers for the CPU whose latency they are measuring. No test
> framework or runner is swapped; every change is configuration, scheduling, or a fixture-readiness
> fix inside the tooling this repo already uses.

---

## 0. Scope

### 0.1 The one sentence this phase implements

Every tier keeps exactly the tests it has today and stops waiting on work it does not have to wait
on: the Go suite starts its containers concurrently instead of one after another, the Playwright UI
suite uses every core the machine has instead of half of them, and the two contention-sensitive
latency specs are moved out of the way so that is safe.

### 0.2 The items this document owns

| # | Item | Measured before | Measured after |
|---|---|---|---|
| A | `go test ./apps/kira-studio/internal/...` — six containers started serially in one package, plus serial teardown | **95.8 s / 95.5 s** | **57.0 / 58.1 / 58.9 s** |
| B | `bun run test:ui` — 245 cases at 2 workers on a 4-core box | **351 s (5 m 51 s)** | **258 s (4 m 18 s)** |
| C | `bun run test:ipc:fe` — 7 cases at 2 workers | **25.9 s** | **10.1 s** |
| D | `bun run typecheck` — four independent `--noEmit` projects run one after another | **11.0 s** | **9.7 s** |
| E | Two latent flakes the above makes more likely to fire (Kafka fixture seed; `grpcclient` echo server) | 4 + 3 failures observed in ~14 full runs | fixed |

### 0.3 Corrections this investigation makes to the row's own premises

The P27 row and the brief that produced it contain four factual claims that measurement did not
support. They are corrected here rather than carried forward.

1. **"`AGENTS.md` mentions `go test -p 1` in some validation instructions."** It does not, at
   `0be9f3e`. `rg -- '-p 1'` across `AGENTS.md`, `docs/`, `scripts/`, `.githooks/` and
   `package.json` returns nothing; `package.json:34` is a bare `"test:go": "go test ./..."`. There
   is no `-p` pin anywhere in the repo, and `go test` has been running at its default
   (`-p` = `GOMAXPROCS` = 4 here) all along. **There is no leftover serialization to remove** —
   §1 F2 shows where the real serialization is instead.
2. **"the real-container suites are dominated in a cold run by image pull and container-startup
   time."** Half right. With images cached, pull is zero and *startup* is indeed the cost — but the
   binding constraint is not how long a container takes to start, it is that six of them are started
   **one after another inside a single package** (§1 F2). The fix is scheduling, not faster startup.
3. **"`playwright.config.ts` currently 2 workers."** It says `workers: '50%'`
   (`playwright.config.ts:20,31,38`), which *resolves* to 2 on this 4-core box. That distinction is
   the whole point of D3: the number is not wrong, the fraction is.
4. **"the build step (`bun run build:test`) may be a meaningful fraction of `test:ui`."** Measured
   and false — 2.5 s cold, 2.3 s warm, against a 351 s tier (0.7 %). §2 D8 declines it.

### 0.4 Not in scope

- **No test is deleted, skipped, merged, or had an assertion relaxed.** `AGENTS.md`'s testing
  philosophy and its explicit carve-out for the adapter conformance suites stay in force.
- **No tooling migration.** Playwright stays Playwright, `go test` stays `go test`, `bun test` stays
  `bun test`, WebKit stays the `ui` project's browser.
- **`tests/e2e-real/`** keeps its own `workers: 2` (`playwright.config.ts:52`) untouched — it boots
  real `-tags server` Go binaries with real adapters, a different resource profile from the mocked
  tier, and it is not part of the normal loop.
- **CI runner sizing / sharding across machines.** There is no live CI for this suite
  (`docs/ARCHITECTURE.md`, "No CI wiring in v1"), so there is nothing to shard onto.
- **Container reuse across separate `go test` invocations** — considered and declined, with the
  cost it would have saved stated: §2 D9.

---

## 1. Findings

Every number in this section is a wall-clock reading from a command actually run in
`/tmp/claude-0/p27-plan`, quoted with the command that produced it.

### F1 — Where the time actually is, per tier

Each tier timed in isolation, on an otherwise idle box, after `bun install` (4.1 s in a fresh
worktree with a warm global cache) and `bun run setup`:

| Tier | Command | Wall clock |
|---|---|---|
| lint | `bun run lint` | **0.75 s** |
| typecheck | `bun run typecheck` | **11.03 s** |
| unit | `bun run test:unit` | **2.68 s** (682 tests, 77 files) |
| ipc frontend | `bun run test:ipc:fe` | **25.94 s** (7 tests, 2 workers) |
| Go | `go clean -testcache && go test ./apps/kira-studio/internal/...` | **95.81 s**, repeated **95.55 s** |
| UI | `bun run test:ui` | **351.5 s** = 5 m 51 s (245 tests, 2 workers, 245 passed) |
| **serial total** | | **≈ 487 s ≈ 8 m 07 s** |

`bun run test:go` (`go test ./...`) measures the same as the `internal/...` form — **58.0 s** with
this phase's fixes applied — because the only two extra packages (`apps/kira-studio` and
`cmd/g1measure`) have no test files. The `./...` spelling is fine as is.

So **`test:ui` is 72 % of the loop and `test:go` is 20 %**; everything else together is under 8 %.
Those two are where a "lot faster" has to come from.

### F2 — The Go suite's real bottleneck is one package starting six containers in a row

`go test` already parallelizes **across** packages: `docker ps` during a baseline run showed
mysql + postgres + kafka + mariadb + a second kafka all up simultaneously, four packages deep,
which is `-p` = `GOMAXPROCS` = 4 doing its job. Nothing serializes the *packages*.

What serializes is **inside** `internal/ipcfixture`. Per-package times from the baseline run,
slowest first:

```
ipcfixture              54.907s      <- 57 % of the 95.8 s wall clock, and it finishes last
adapters/kafka          35.321s
adapters/mysqlfamily    25.940s
adapters/testsupport    22.199s
adapters/clickhouse     16.879s
adapters/sqs            10.300s
adapters/postgres       10.026s
adapters/s3              8.171s
adapters/mongo           6.633s
… 25 further packages, all under 5 s
```

`go test -v ./apps/kira-studio/internal/ipcfixture/` (**58.874 s** standalone) shows why:

```
--- PASS: TestFixture_ClickHouse (7.43s)
--- PASS: TestFixture_Kafka      (7.20s)
--- PASS: TestFixture_MariaDB    (9.37s)
--- PASS: TestFixture_MySQL     (12.55s)
--- PASS: TestFixture_Redis      (0.60s)
--- PASS: TestFixture_SQS        (2.68s)
ok  …/internal/ipcfixture         57.100s
```

Six tests, six *different* containers, **one at a time** — 39.8 s of test time. And the package
total is 57.1 s, so a further **≈ 17 s is `TestMain`'s teardown**: `ipcfixture/mariadb_test.go:18-27`
calls six `testsupport.Stop*()` in sequence after `m.Run()`, each a synchronous
`container.Terminate`. Nothing else in the package runs during either the six startups or the six
teardowns.

The same shape, smaller, in two more packages: `adapters/kafka/main_test.go:13-17` (Kafka +
Kafka-SASL) and `adapters/mysqlfamily/mysqlfamily_test.go:32-37` (MariaDB + MySQL) each start two
containers serially and tear two down serially.

### F3 — `t.Parallel()` cannot be the fix, and the reason is concrete

There is **not one `t.Parallel()` in the whole of `apps/kira-studio/internal/`** (`rg -l 't.Parallel()'`
→ 0 files). The obvious move — mark `ipcfixture`'s six tests parallel — was tried and **fails
outright**:

```
panic: testing: test using t.Setenv, t.Chdir, or cryptotest.SetGlobalRandom can not use t.Parallel
  testing.(*T).Setenv(…)
  …/internal/ipcfixture.NewApp(…)          harness.go:49
  …/internal/ipcfixture.TestFixture_SQS(…)  sqs_test.go:28
```

`ipcfixture/harness.go:47-52` gives every test its own app by setting `KIRA_HOME` and
`KIRA_INSECURE_SECRETS` with `t.Setenv`, because `storage.Open()` (`internal/storage/db.go:65`)
resolves its directory from the process environment via `config.KiraHome()`
(`internal/config/paths.go:12`). Process-global env is not parallel-safe, and Go's testing package
refuses the combination by design.

Making it parallel would therefore mean threading an explicit home directory through `storage.Open`
— **production code, changed to suit a test harness**. This phase does not do that. D1 gets the same
concurrency without touching a line of non-test code.

### F4 — `testsupport`'s fixture memo is already concurrency-safe, which is what makes D1 cheap

`testsupport/fixture.go` is a mutex-guarded, start-at-most-once memo (`fixture[T].get`), and each
kind has an unexported `start<Kind>() (*T, error)` behind an exported `Start<Kind>(t *testing.T)`.
So a `TestMain` can call the same memo from several goroutines *before* `m.Run()` and every later
`Start<Kind>(t)` becomes an instant cache hit — no `t.Parallel()`, no env-var race, no
production-code change, and a failed start is still remembered and still surfaces through the
existing `t.Fatalf`. The type's own doc comment already records the last bug in this area (a
`t.Cleanup`-wired teardown that turned an 8 s suite into 50 s), so this is the seam it was built for.

### F5 — The Kafka fixture has a real readiness gap that concurrency exposes

Starting Kafka and Kafka-SASL concurrently reproduced this, **four times across the measurement
runs** (once at the default `-p`, twice at `-p 8`, once at `-p 12`), 23 failing tests each time:

```
--- FAIL: TestKafka_ConnectDisconnect (0.06s)
    kafka_test.go:107: kafka container: create topic orders: broker closed the connection
    immediately during api versions negotiation, which often happens when the broker requires
    TLS but the client is using plaintext: is TLS missing?
```

This is not a TLS problem and not caused by concurrency — concurrency only widens the window.
`testsupport/kafka.go:74-113` waits on the `testcontainers-go` Kafka module's own log-regex
readiness hook, then immediately issues `admin.CreateTopics` as the very first request the broker
ever sees. The log line fires before the advertised listener is actually serving; under CPU
pressure the gap is wide enough that franz-go's first connection is closed mid-`ApiVersions`.

A `client.Ping` poll inserted between container start and `seedKafka` removed it: **three
consecutive full-suite runs, zero Kafka failures** (58.9 / 57.4 / 57.0 s), and it also unblocked the
higher `-p` values that had failed before (F7).

### F6 — A second, pre-existing flake, unrelated to containers

```
--- FAIL: TestDescribe_Reflection_NoReflection_YieldsSchemaError (0.00s)
    descriptors_test.go:101: error = EOF, want a *Error with code E_GRPC_SCHEMA
```

Seen **three times in ~14 full-suite runs**, and never in isolation:
`go test -count=20 -run TestDescribe_Reflection_NoReflection_YieldsSchemaError ./…/grpcclient/`
passes clean in 0.049 s. `grpcclient/testserver_test.go:168-192` returns `echoServer{addr: …}` as
soon as `net.Listen` succeeds, with `go func() { _ = s.Serve(lis) }()` possibly not yet scheduled.
The kernel accepts the client's connection into the backlog, nobody sends the HTTP/2 preface back,
and the client sees `EOF` instead of the `Unimplemented` status the test is asserting the
classification of.

It is pre-existing, it costs a whole re-run of a 95 s tier when it fires, and this phase raises
system load. It belongs here.

### F7 — `-p` above the default buys ~8 %, and is not worth pinning

With the D1 + D2 fixes in place:

| `-p` | Wall clock | Result |
|---|---|---|
| default (= `GOMAXPROCS` = 4) | **57.0 / 58.1 / 58.9 s** | clean ×3 |
| 6 | **53.6 s** | clean (Kafka); one `grpcclient` flake (F6) |
| 8 | **52.4 s** | clean |

Before the Kafka readiness fix, `-p 8` failed on Kafka **on both attempts** and `-p 12` failed too
(57.2 s, 23 failures) — the flake, not the parallelism, was the ceiling.

So there *is* ~8 % more available. It is declined (D7): `-p`'s default is already `GOMAXPROCS`, so
it scales with the machine, and pinning `8` would **reduce** parallelism on the 10–12-core Mac this
product is developed on while raising peak concurrent-container memory on a small box. An 8 % gain
is not worth trading a machine-scaling default for a fixed number.

### F8 — `IsDockerAvailable()` runs 144 times per suite

`testsupport/postgres.go:35-40` shells out to `docker info` on **every** `Start<Kind>(t)` call, and
there are **144 such call sites** across `*_test.go`. One probe measures **60 ms**, so that is
≈ 8.6 s of CPU time per suite run, spread across the parallel slots. Memoizing it with a
`sync.Once` is a two-line change with no behavioural difference (the daemon does not appear or
disappear mid-run).

### F9 — The UI tier is already ~perfectly parallel; the only lever is worker count

From the baseline run's JSON reporter (245 tests, 2 workers, 351 s wall):

- **sum of individual test durations = 672.9 s**
- 672.9 / (351 × 2) = **95.9 % parallel efficiency** — Playwright's scheduler is not the problem.
- median test **1.21 s**, minimum **0.50 s**, longest **33.1 s** (`interaction.spec.ts`).
- `fullyParallel: true` is already set on the `ui` project (`playwright.config.ts:30`).
- **There is no `test.describe.configure({ mode: 'serial' })` anywhere in `apps/kira-studio/tests/`.**
  The only occurrence of that string is a comment in `budgets.spec.ts:554-556` explaining why it
  would *not* help. Nothing to remove.
- CPU actually used: 646 s of user time over 351 s wall = **1.84 of 4 cores**. Two cores idle.

Slowest files by total test time: `slick-grid.spec.ts` 110.8 s (17 tests), `autocomplete.spec.ts`
49.4 s, `console.spec.ts` 47.7 s, `sql-schema.spec.ts` 34.8 s, `interaction.spec.ts` 33.1 s (1 test).

### F10 — Raising workers alone breaks `budgets.spec.ts`, at 4 **and** at 3

| Workers | Wall clock | Result |
|---|---|---|
| 2 (`'50%'`, today) | **351 s** | 245 passed |
| 3 (`'75%'`) | **259 s** | **1 failed** — `budgets.spec.ts:557`, p50 = **22 ms**, bound ≤ 12 |
| 4 (`'100%'`) | **227 s** | **1 failed** — `budgets.spec.ts:557`, p50 = **15 ms**, bound ≤ 12 |

Exactly one test fails, and it is the one whose own comment predicted it
(`budgets.spec.ts:548-557`): *"7-8 ms alone, a real and reproducible 9-10 ms under full-suite
contention… the flakiness here is cross-file worker contention, which no in-file serialization mode
addresses."* It measures scroll-response latency in wall-clock milliseconds; running four WebKit
instances on four cores is a different machine from running two.

Worker count alone is therefore **not** a usable lever. It needs D4.

### F11 — Only two specs are wall-clock-budget specs, and together they are 5 % of the tier

Going file by file through every `toBeLessThan*` in `tests/ui/`, the assertions split cleanly:

- **Latency budgets, measured in real milliseconds** — `budgets.spec.ts` (1 test, **23.7 s**) and
  `perf.spec.ts` (1 test, **13.7 s**). 37.4 s, **5.6 %** of the tier's 672.9 s of test time.
- **Everything else is structural** — element counts, DOM-node caps, retained-byte bounds, ordering.
  `scroll-trace.spec.ts` (2.9 s) has no timing bound at all; `slick-grid.spec.ts`'s "150 ms sandbox
  gate" survived every 4-worker run in this investigation.

Two files, one test each. That is small enough to isolate.

### F12 — `scripts/setup.sh`'s caching claim is true, verified rather than assumed

`AGENTS.md` claims `scripts/setup.sh` re-runs the expensive steps only on a real staleness check.
Measured:

- **first `bun run setup`** in a fresh worktree: **4.43 s** — bun install, `go mod download`, and
  `wails3 task common:generate:bindings` (708 packages / 21 services / 89 methods, 3.95 s of it).
- **second `bun run setup`**, nothing changed: **0.135 s**, and `grep -c 'generate:bindings'` on its
  output is **0**. The `apps/kira-studio/.task/bindings.stamp` gate (`scripts/setup.sh:118-128`)
  short-circuits, and `bun install` reports "Checked 293 installs across 352 packages (no changes)
  [15 ms]".

There is nothing to fix here. `bun install` on an already-populated `node_modules` is likewise
**12-15 ms**, not a cost worth caching around.

### F13 — `bun run build:test` is not a lever

**2.547 s** cold, **2.346 s** warm (`vite build`, rolldown, 836 modules, "built in 2.0 s"), against
a 351 s tier. **0.7 %.** Caching it or gating it on a source-change check would save under two
seconds and add a staleness failure mode where a stale `dist/` silently tests the wrong bundle.

### F14 — The UI suite's fixed-delay waits are mostly semantic, not lazy

59 `page.waitForTimeout(...)` call sites in `tests/ui/`, summing to **10.66 s** of literal delay
before loop multipliers; with the loops (`slick-grid.spec.ts:410-415` ×15, `:479-487` ×4×20)
the real total is on the order of **15-20 s of the 672.9 s** — 2-3 %, i.e. under 5 s of wall clock
at 4 workers.

More importantly, most of them **are the test**. `slick-grid.spec.ts:479-487` paces a synthetic
fling at 40/100/200/456 px per frame with `waitForTimeout(16)` between frames; replacing that with
`waitFor`/polling would not speed anything up, it would measure something else. 24 of the 59 sites
are in `slick-grid.spec.ts` and 12 in `tree.spec.ts`, both of which are frame-pacing.

**Declined as a bulk change** (D8). A handful of genuine settle-waits exist (`waitForTimeout(300)`
for a "quiet window", `waitForTimeout(500)`), but converting them is a per-site judgement worth a
few seconds, not a phase-level lever, and each conversion risks changing what the test proves.

### F15 — `typecheck` is four independent projects run one after another

`package.json:23` chains them with `&&`. Individually: `typecheck:web` (vue-tsc) **8.99 s**,
`typecheck:tests` **0.64 s**, `typecheck:unit` **0.60 s**, `typecheck:api-core` **0.27 s** — total
**11.03 s**. They are four separate `--noEmit` invocations over disjoint `tsconfig` projects with no
ordering relationship. Run concurrently: **9.69 s**. A 1.3 s saving, on every commit (the
`.githooks/pre-commit` hook runs `bun run lint` + `bun run typecheck`).

### F16 — `test:ipc:fe` inherits the same 50 % worker fraction

7 tests, `fullyParallel: true`, `workers: '50%'` (`playwright.config.ts:38`): **25.94 s**. At
`'100%'`: **10.11 s**, 7 passed. No timing-sensitive assertions in that project at all — it is a
protocol-shape tier. Free.

---

## 2. Decisions

### D1 — `ipcfixture`, `adapters/kafka` and `adapters/mysqlfamily` prewarm their containers concurrently from `TestMain` (F2, F3, F4)

Add to `internal/adapters/testsupport` a small, exported prewarm seam over the existing memo:

```go
// Prewarm starts the named fixtures concurrently, so a package that needs several containers pays
// the slowest one's startup instead of the sum. Every fixture is memoized (fixture.go), so each
// later Start<Kind>(t) is a cache hit; a start that fails is remembered and still surfaces through
// that Start's own t.Fatalf. A no-op without Docker — each Start<Kind> still skips on its own.
func Prewarm(kinds ...string)

// StopConcurrently tears down several memoized fixtures at once, for a TestMain that owns more
// than one.
func StopConcurrently(stops ...func())
```

backed by a `map[string]func()` of `<memo>.get(start<Kind>)` closures — one entry per kind, in one
new file next to `fixture.go`, no change to any existing fixture's own API.

Then, in the three `TestMain`s that own more than one container:

- `ipcfixture/mariadb_test.go:18` — `Prewarm("mariadb","mysql","clickhouse","redis","sqs","kafka")`
  before `m.Run()`, and the six `Stop*` calls after it become one `StopConcurrently(...)`.
- `adapters/kafka/main_test.go:13` — `Prewarm("kafka","kafkasasl")` / `StopConcurrently(StopKafka, StopKafkaSasl)`.
- `adapters/mysqlfamily/mysqlfamily_test.go:32` — `Prewarm("mariadb","mysql")` / `StopConcurrently(StopMariadb, StopMysql)`.

**Why this and not `t.Parallel()`:** F3 — `t.Parallel()` panics against `harness.go`'s `t.Setenv`,
and the alternative would be reshaping `storage.Open` for a test's benefit. This gets the same
overlap with zero production-code change and zero change to how any individual test runs: the tests
stay strictly sequential inside their package, they just find their container already up.

**Measured, `ipcfixture` alone:** `go test -v ./…/ipcfixture/` **58.874 s → 27.615 s**; the package's
own reported time 57.100 s → 25.090 s; and the six tests drop from 7.43/7.20/9.37/12.55/0.60/2.68 s
to **0.13/0.16/0.20/0.10/0.09/0.09 s** — all container time is now overlapped in the prewarm, and
the ~17 s of serial teardown collapses to about one `Terminate`.

**Measured, whole tier:** 95.8 s → **64.4 s** from this decision alone, before D2 and D3.

**Not applied to single-container packages.** `adapters/{postgres,clickhouse,mongo,redis,s3,sqs,sqlite}`
each start exactly one container as the first statement of their first test; there is nothing to
overlap it with. Adding `Prewarm("kafka")` to `adapters/testsupport`'s own `TestMain` **was** tried
on the theory that its Kafka start could overlap its LocalStack tests — **measured 59.3 s vs 58-59 s,
no change** (its Kafka test runs first anyway). Not adopted.

### D2 — The Kafka fixture waits for the broker to actually serve before seeding (F5)

In `testsupport/kafka.go`'s `startKafka`, between the container start and `seedKafka`, poll until a
real request succeeds:

```go
// The module's log-based readiness hook fires before the advertised listener is serving, so the
// first request can be closed mid-ApiVersions negotiation. Poll a real request instead.
func waitKafkaBrokerReady(ctx context.Context, client *kgo.Client) error   // client.Ping, 250 ms
                                                                           // interval, 60 s cap
```

**Why it belongs in this phase and not a separate bug fix:** D1 doubles the pressure at exactly the
moment this window is open (two brokers starting at once), and F7's higher-`-p` measurements are
unreadable without it. It also fixes a flake that is already reachable today under load.

**Measured:** four Kafka failures across the pre-fix measurement runs → **zero across three
consecutive full-suite runs after** (58.9 / 57.4 / 57.0 s), and `-p 8`, which had failed twice
before, now passes.

Apply the same treatment to `startKafkaSasl` if inspection shows it seeds through the same
first-request path; if it already gates on a stronger wait strategy, leave it alone and say so in
the commit message rather than adding a redundant poll.

### D3 — `IsDockerAvailable()` is memoized (F8)

`sync.Once` around the `docker info` probe in `testsupport/postgres.go:35-40`. 144 call sites ×
60 ms. The daemon does not appear or disappear mid-run; the current behaviour re-answers the same
question 144 times. Worth ≈ 1-4 s of the tier, and it is two lines.

### D4 — `budgets.spec.ts` and `perf.spec.ts` move to their own serial Playwright project, and everything else runs at `'100%'` (F9, F10, F11)

`playwright.config.ts`:

```ts
{
  name: 'ui',
  testDir: './tests/ui',
  testIgnore: ['budgets.spec.ts', 'perf.spec.ts'],
  use: { browserName: 'webkit' },
  fullyParallel: true,
  workers: '100%',
},
{
  // These two measure wall-clock latency in real milliseconds, so the number of other browsers on
  // the box is part of what they measure (budgets.spec.ts:548-557 says so itself). They run alone,
  // after `ui` has finished, so the rest of the tier can use every core.
  name: 'ui-timing',
  testDir: './tests/ui',
  testMatch: ['budgets.spec.ts', 'perf.spec.ts'],
  use: { browserName: 'webkit' },
  fullyParallel: false,
  workers: 1,
  dependencies: ['ui'],
},
```

and `package.json`'s `test:ui` gains `--project=ui-timing` alongside the existing `--project=ui`.

**This makes the two specs better tests, not weaker ones.** In the split run, `budgets.spec.ts`
reported `scroll response (work) p50 = 8.0 ms` — identical to the 2-worker baseline's 8.0 ms, and
matching the spec's own note that the uncontended value is 7-8 ms. Every other budget it prints was
**equal to or better than** the 2-worker baseline (`horizontal, work` p50 26 → 21 ms;
`horizontal, end-to-end` 33 → 26 ms; `vertical, wide table, end-to-end` p95 85 → 50 ms). A later
phase can now tighten those bounds toward the real 7-8 ms if it wants to; today's 12 ms exists only
because of the contention this decision removes.

**Measured, whole tier:** `bun run test:ui` **351 s → 258 s (5 m 51 s → 4 m 18 s), 245 passed,
zero failures** — versus 227 s *with a failure* at plain 4 workers and 259 s *with a failure* at 3.
The split is both faster than 3 workers and correct.

**`'100%'`, not a fixed number, on purpose.** This box has 4 cores and saturates there: the sum of
per-test durations inflates from 672.9 s at 2 workers to 820.1 s at 4 (+22 %) purely from CPU
contention, and user time rises to 2.69 of 4 cores. A larger dev machine (the 10-12-core Mac this
product targets) gets proportionally more from the same setting, which a hard-coded `4` would throw
away.

**The one behavioural cost, accepted:** `dependencies: ['ui']` means a failure anywhere in `ui`
leaves `ui-timing` unrun rather than failed. That is fail-fast, it is visible in the summary, and
`playwright test --project=ui-timing` re-runs just those two. The alternative — two separate
`playwright test` invocations chained with `&&` — costs a second process start and clobbers the HTML
report, for the same short-circuit behaviour.

### D5 — `ipc-frontend` goes to `'100%'` too (F16)

Same one-word change at `playwright.config.ts:38`. **25.94 s → 10.11 s**, 7 passed. That project has
no latency assertions, so it needs no D4-style split.

`e2e-real`'s explicit `workers: 2` is **not** touched — it boots real Go server binaries with real
adapters and real databases, and its own config comment records why 2 is the proven number there.

### D6 — The two flakes are fixed, not tolerated (F5, F6)

D2 covers Kafka. For `grpcclient`: `testserver_test.go`'s `startEchoServer` gains a readiness gate —
dial the address and wait for the gRPC server to answer before returning `echoServer`, instead of
returning the instant `net.Listen` succeeds. Same shape as D2's, one layer down.

A flaky test in a 95 s tier costs a full re-run when it fires — three times in fourteen runs here.
Fixing it is squarely in service of "make the tests faster to actually get through".

### D7 — `-p` is left at its default (F7)

Declined, with the number stated: `-p 8` measures **52.4 s** against the default's **57.0-58.9 s**,
about 8 %. Pinning a literal would cut parallelism on a bigger machine (the default is already
`GOMAXPROCS`) and raise peak concurrent-container memory on a smaller one. If a future CI runner
makes the tradeoff clearly favourable, the measurement to redo is in F7.

### D8 — Three levers the brief named, measured and declined

| Lever | Measurement | Verdict |
|---|---|---|
| Cache/skip `bun run build:test` | 2.5 s cold, 2.3 s warm, of a 351 s tier (F13) | **0.7 %.** Declined — adds a stale-`dist/` failure mode for under two seconds |
| Make `scripts/setup.sh` / bindings generation cache properly | It already does: 4.43 s first, **0.135 s** second, bindings step skipped (F12) | Nothing to fix. `AGENTS.md`'s claim verified, not assumed |
| Replace `waitForTimeout` with polling across the UI suite | 59 sites, ≈ 15-20 s of 672.9 s; most are deliberate frame pacing (F14) | **2-3 %,** and a bulk rewrite would change what several specs measure. Declined as a phase lever |

### D9 — Container reuse across `go test` invocations is declined, with its cost stated

The SPEC row names it as a candidate. `testcontainers-go` can keep containers alive between runs
(reuse-by-name, Ryuk disabled), which would remove essentially all of the ~25-30 s of remaining
container startup from a *repeat* run.

Declined, because these are not read-only fixtures. `adapters/mysqlfamily`, `adapters/postgres`,
`adapters/sqlite`, `adapters/mongo` and `adapters/s3` all exercise mutate and DDL paths
(`AGENTS.md`: *"mutate, and DDL round trips where the engine has a DDL surface at all"*), so a
reused container carries the previous run's writes into the next one. That manufactures exactly the
class of bug this repo's testing philosophy is built to catch — a test that passes only because of
what ran before it — and it makes a first run and a second run different tests. A 25 s saving does
not buy that.

### D10 — `typecheck`'s four projects run concurrently (F15)

`package.json`'s `typecheck` becomes a single `sh -c '… & … & … & … & wait'` over the four existing
`typecheck:*` scripts, which stay individually invokable. **11.03 s → 9.69 s.**

This is the smallest lever in the phase and it is listed last on purpose. It earns its place only
because `.githooks/pre-commit` runs it on every single commit. If the implementer finds the
shell-level `&`/`wait` distasteful in `package.json`, dropping this item costs 1.3 s and nothing
else — say so in the commit message rather than half-doing it.

---

## 3. Commit sequence

Conventional Commits, one concern each. `bun run lint` and `bun run typecheck` per commit; the two
expensive tiers run once at the end per `AGENTS.md`'s cadence rule, with fixes as follow-ups.

| # | Commit | Covers |
|---|---|---|
| T1 | `test(testsupport): a prewarm seam over the fixture memo` | D1's new `Prewarm`/`StopConcurrently` in `internal/adapters/testsupport`. **No caller yet** — nothing changes behaviourally, so T1 is provably inert |
| T2 | `fix(testsupport): wait for the Kafka broker to serve before seeding it` | D2. Lands **before** T3, so T3's own measurement is not reading a flake |
| T3 | `test(go): the three multi-container packages start and stop their containers concurrently` | D1's three `TestMain` edits (`ipcfixture`, `adapters/kafka`, `adapters/mysqlfamily`) |
| T4 | `test(testsupport): probe the Docker daemon once per test binary` | D3 |
| T5 | `fix(grpcclient): the echo test server is ready before its address is handed out` | D6 |
| T6 | `test(ui): the two latency specs run alone, and everything else uses every core` | D4 — `playwright.config.ts`'s `ui`/`ui-timing` split plus `package.json`'s `test:ui` |
| T7 | `test(ipc): the frontend ipc project uses every core` | D5 |
| T8 | `chore(typecheck): the four projects run concurrently` | D10 (droppable, see D10) |
| T9 | `docs(v1.2): P27 implemented` | The SPEC row, with the re-measured after-numbers from §4.4 — **written from that run's output, not from this document's** |

Ordering notes: **T2 must precede T3.** T3 is what makes two Kafka brokers start simultaneously, and
without T2 the suite fails on it — F5 reproduced that four times. T1 before T3 for the obvious
reason. T4, T5, T6, T7, T8 are mutually independent and may land in any order after T3. T9 last, and
only after §4.4's re-measurement has actually been run.

---

## 4. Verification plan

### 4.1 What must stay true

**Every test that passes today still passes, and no test is skipped.** The suites' own counts are
the check: **245** in `test:ui` (243 in `ui` + 2 in `ui-timing`), **7** in `test:ipc:fe`, **682** in
`test:unit`, and the same 34 `ok` package lines from `go test ./apps/kira-studio/internal/...`. A
count that drops means something got ignored by a `testIgnore` glob or skipped by a fixture, and is
a failure of this phase regardless of how fast the run was.

Specifically for D4: `--project=ui` and `--project=ui-timing` must partition `tests/ui/` exactly.
Confirm with `playwright test --list` per project — 243 and 2 — before trusting any timing number.

### 4.2 Unit tests

**None added.** Every change here is a test-harness or configuration change; `AGENTS.md`'s bar
("unit tests exist only for advanced, complex or deeply nested logic") excludes all of it. `Prewarm`
is a `WaitGroup` over an existing mutex-guarded memo; the readiness polls are loops with a deadline.

### 4.3 Correctness checks specific to this phase's own risks

1. **`KIRA_IPC_FIXTURES=write` still regenerates all six fixtures.** D1 changes when the six
   `ipcfixture` containers start, not what the tests do, and the six generators write six distinct
   files — but run `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...`
   once and confirm `git status` shows **no diff** in `apps/kira-studio/tests/ipc/*/​*.fixture.ts`
   after `bunx biome check --write`. A byte-identical regeneration is the proof that concurrent
   startup did not perturb any capture.
2. **The suite still skips cleanly with no Docker.** Stop the daemon and run
   `go test ./apps/kira-studio/internal/adapters/...` — every container-backed test must `SKIP` with
   `DockerUnavailableMessage`, not fail and not hang. `Prewarm` must be a no-op in that state, and
   D3's memo must not turn one probe's answer into a wrong one.
3. **A container that genuinely fails to start still fails loudly.** `Prewarm` swallows the error
   into the memo by design; the later `Start<Kind>(t)` is what reports it. Verify by pointing one
   kind at a nonexistent image via its `KIRA_COMPAT_IMAGE_<KIND>` override and confirming the test
   fails with the container error, not with a nil-pointer panic.
4. **The two flake fixes hold.** Run `go test ./apps/kira-studio/internal/...` **three times** after
   T5 and require **zero** failures across all three — that is the same sample size that showed
   4 Kafka and 3 `grpcclient` failures before.

### 4.4 Re-measurement — the phase's own claim, checked rather than asserted

This is the part that decides whether P27 did what it says. Run each of these on an idle box, in
this order, and record the actual numbers into the SPEC row (T9):

```sh
go clean -testcache && time go test ./apps/kira-studio/internal/...   # ×3
time bun run test:ui                                                   # ×2
time bun run test:ipc:fe
time bun run typecheck
time bun run test:unit
time bun run lint
```

Compare against the before-numbers in §1 F1, which were taken with the same commands in the same
worktree on the same box:

| Tier | Before (measured) | Target (measured on the prototypes) |
|---|---|---|
| `go test ./…/internal/...` | 95.8 s / 95.5 s | **57-59 s** (−39 %) |
| `bun run test:ui` | 351 s | **258 s** (−26 %) |
| `bun run test:ipc:fe` | 25.9 s | **10.1 s** (−61 %) |
| `bun run typecheck` | 11.0 s | **9.7 s** (−12 %) |
| `bun run test:unit` | 2.68 s | unchanged |
| `bun run lint` | 0.75 s | unchanged |
| **serial total** | **≈ 487 s (8 m 07 s)** | **≈ 339 s (5 m 39 s)** — **−30 %** |

**Two runs of `test:ui`, not one**, because D4's gain and its flake-freedom are separate claims: the
first run proves the time, the second proves the two timing specs pass repeatably alone. If either
run fails on `budgets.spec.ts` or `perf.spec.ts`, D4 has not worked and the right response is to
investigate the split — **never** to relax the 12 ms bound.

**If the after-numbers come in materially worse than the table**, say so in the SPEC row with the
real numbers rather than quoting this document's. These were measured on a 4-core sandbox; a
different box will land somewhere else, and `'100%'` in particular should do *better* on a machine
with more cores, not the same.

### 4.5 What is deliberately not verified

- **A cold-image run.** Every number here assumes the nine images are already pulled. A first-ever
  run on a clean machine pays a pull this phase cannot affect.
- **macOS.** The whole investigation ran on Linux with `dockerd`. The changes are all
  platform-neutral (a `WaitGroup`, a `sync.Once`, two config fields, a `client.Ping` loop), but the
  *numbers* are this box's.
- **`test:e2e-real`, `test:matrix`, `test:compat`.** Out of the normal loop by design, untouched by
  every decision above.

---

## 5. What this phase deliberately does not do

- **It does not delete, skip, or loosen a single test or assertion.** The only assertion this phase
  goes near is `budgets.spec.ts:557`, and it goes near it by giving it a *quieter* machine — the
  measured p50 under D4 is 8 ms against a 12 ms bound, versus 15 ms and 22 ms when the same bound is
  simply run at more workers. Loosening the bound would have been the cheap way to get 4 workers;
  D4 is the honest one.
- **It does not migrate any runner or framework.** No Playwright replacement, no `gotestsum`, no
  Vitest, no browser swap.
- **It does not touch production code.** Every edit lands in `*_test.go`, `internal/adapters/testsupport/`,
  `playwright.config.ts` or `package.json`. F3 is where the temptation was — reshaping
  `storage.Open`'s `KIRA_HOME` resolution to allow `t.Parallel()` — and D1 exists to avoid it.
- **It does not reuse containers across runs** (D9) or pin `-p` (D7). Both were measured; both were
  declined for stated reasons rather than skipped.
- **It does not chase the last 8 %.** After this phase the Go tier is bound by total container work
  divided across `GOMAXPROCS` slots, and the UI tier is bound by how many CPU-saturating WebKit
  instances the box can hold. Going further means either a bigger machine or less work, and less
  work would mean less coverage.
