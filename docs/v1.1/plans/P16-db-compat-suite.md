# P16 — DB adapter min/max version compatibility suite

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:31`, P16 row): *"For each database/queue
> adapter, determine the oldest and newest server version its Go client library actually supports,
> and add an on-demand compatibility suite (not run as part of the regular CI/test run) that runs
> the adapter's existing conformance tests against both the oldest and the newest supported server
> image for that kind — the same coverage that exists today, just run against the version extremes
> instead of one pinned version. Also add a note to the connection-add UI, per connection kind,
> stating its minimum supported server version. Once built, actually run the new suite once against
> real containers and fix whatever it finds."* Why: *"Version-boundary bugs are exactly the kind of
> thing development against one pinned test-fixture version never catches, and it's cheap to build
> once the adapters are otherwise stable."*
>
> **The headline, in one line: the suite itself is small — one env-var image override in
> `testsupport`, one shell driver, one `workflow_dispatch`-only workflow — and the hard part is that
> the version *floor* is not what the client library says, because for two of the ten kinds this
> repo's own code and its own seed SQL are strictly newer than the driver's documented minimum.**
>
> - **MySQL.** `go-sql-driver/mysql` v1.10.0's README says *"MySQL (5.7+) … supported by
>   maintainers"* (`README.md:49`) and its CI genuinely runs against 5.7
>   (`.github/workflows/test.yml:37-48`). But `mysqlfamily/definition.go:26-28` reads
>   `information_schema.CHECK_CONSTRAINTS` **unconditionally**, and that view does not exist before
>   **MySQL 8.0.16**; on top of that `0008_mysql_seed.sql` uses `DEFAULT (CURRENT_DATE)` (`:64`),
>   `DEFAULT (UUID())` (`:76`) — expression defaults, 8.0.13+ — and `WITH RECURSIVE` (`:155`), 8.0+.
>   The conformance suite cannot even be *seeded* on 5.7. **The real floor is MySQL 8.0**, and it is
>   a property of this app, not of the driver.
> - **MariaDB.** Same driver, README floor 10.5 (`README.md:49`), CI floor 10.5
>   (`test.yml:46-47`). But `0002_mariadb_seed.sql:67` declares `uuid_a UUID` — MariaDB's **native
>   `UUID` type, 10.7+** — with its own comment already saying so. **The real floor is MariaDB
>   10.11** (the first LTS at or above 10.7), which is also the oldest MariaDB still in support:
>   10.5 went EOL 2025-06-24 and 10.6 on 2026-07-06.
> - **ClickHouse has no Go client library at all.** `clickhouse/client.go:4-9` imports `net/http`
>   and nothing else (`docs/ARCHITECTURE.md:217-225`, B11). There is no compatibility matrix to
>   read, so its bounds come from ClickHouse's own published release policy instead, stated as such.
> - **SQLite has no server**, and **SQS/S3 have no server version at all** — LocalStack's own major
>   version stands in as the thing worth varying, and that is said plainly rather than dressed up as
>   a server version.
>
> **Six version assertions in the conformance suites hard-pin today's image and will fail on both
> ends the moment the image moves** — `^PostgreSQL 17` (`postgres_test.go:24`), `^MySQL 8\.`
> (`mysqlfamily_test.go:128`), `^MongoDB 7` (`mongo_test.go:37`), `^Redis 7` (`redis_test.go:37`).
> These are not incidental: they are the one thing in each suite that *must* stay a real assertion
> across versions, so they get derived from the resolved image tag rather than relaxed to `\d+`.
>
> **Every image in the proposed table was checked against the real registry** — **[verified here]**,
> `https://hub.docker.com/v2/repositories/<repo>/tags/<tag>` returns 200 for each one and 404 for
> the ones that do not exist (`postgres:19`, `mysql:10.0`, `mariadb:12.4`,
> `clickhouse/clickhouse-server:26.9`, `mongo:9`, `redis:9`, `localstack/localstack:5` are all 404
> today). No version number in §3 is assumed to map to a pullable image; each was asked.
>
> **The final step is a real run, not a simulation.** §6 requires starting `dockerd` per AGENTS.md,
> pulling ~18 images through `mirror.gcr.io`, and running the whole conformance corpus 18 times.
> That is on the order of an hour or two of wall clock in this sandbox and it is the deliverable,
> not a formality — the version table is a hypothesis until it runs green.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `7b31d78` (`test(ui): the fake-data generator dialog`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P11 and P13-P15 have landed; P12 has not.

Nothing in P15 touches an adapter, a fixture or the connection dialog's engine/details steps beyond
what it already shipped, so P16 starts from a stable adapter surface. That stability is the reason
SPEC.md places this phase here ("cheap to build once the adapters are otherwise stable").

### 0.2 Scope

1. **A per-kind image override** in `apps/kira-studio/internal/adapters/testsupport/`, so every
   existing container fixture can be pointed at a different server image by environment variable
   without editing a single source file (D2).
2. **A version-derived server-version assertion** replacing the six hardcoded regexes, so running
   against a different image still asserts *the version we asked for* rather than asserting nothing
   (D4).
3. **`scripts/db-compat.sh`** — the on-demand driver: for each (kind, min|max) pair it pulls the
   image (through `mirror.gcr.io` when asked), retags it, exports the override, and runs that
   adapter's existing `go test` package. One summary table at the end, every pair run even when an
   earlier one fails (D5).
4. **`.github/workflows/db-compat.yml`** — `workflow_dispatch` **only**, no `push`, no
   `pull_request`, not referenced by `ci.yml` (D6).
5. **A per-kind minimum-server-version note in the connection-add dialog**, sourced from one shared
   `MIN_SERVER_VERSION` map beside the existing `DEFAULT_PORT` map (D8), plus one `tests/ui` case.
6. **A real execution of the whole suite** and a fix for everything it finds (§6), with the results
   written back into this document's §3 table so the published numbers are the verified ones.

### 0.3 Not in this phase

- **Making the compat suite part of `bun run test:go`, `ci.yml`, or any push/PR trigger.** SPEC.md
  says "not run as part of the regular CI/test run" and that is a hard boundary: the default (no
  override env var set) must stay byte-identical to today's behaviour, so `test:go` keeps pulling
  exactly the images it pulls now.
- **Testing every version in between.** The deliverable is the two extremes per kind. A full matrix
  of every supported major is 40+ container starts and buys much less than the ends do.
- **Forking a second, 5.7-compatible MySQL seed** (or a 10.5-compatible MariaDB seed) so the
  driver's own documented floor becomes reachable. F3/F4 explain exactly what that would cost; it is
  OQ-1, and the honest answer for now is that the app's floor is higher than the driver's and the UI
  says so.
- **Adding a runtime version gate** — refusing to connect, or warning in the app, when the server is
  below the minimum. The UI note is informational (SPEC.md asks for "a note"), and a connect-time
  probe that blocks is a behaviour change nobody asked for. OQ-2.
- **Any change to what the conformance tests assert**, beyond the six server-version regexes. If a
  case fails on an extreme, the fix goes in the adapter (or, where the case genuinely encodes
  version-specific server behaviour, in a documented per-version skip with the server's own reason
  named) — never by weakening an assertion to make a version pass.
- **Kafka via `apache/kafka` images.** F9: the `testcontainers-go` Kafka module's starter script is
  Confluent-image-specific by construction, so the Kafka matrix stays inside `confluentinc/cp-kafka`.
- **Bumping the default pinned images.** P19 ("Dependency and runtime version bump") owns that. P16
  may *discover* that a default pin is stale (it will: `redis:7`, `mongo:7`, `localstack:3` all are)
  and says so in §8, but changing the default is P19's call, not this phase's.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every version claim below is **[verified in source]**
  against a file in this tree or in the Go module cache at the cited `file:line`, **[verified
  here]** where it was executed in this sandbox (registry probes), or **[verified upstream]** with a
  real URL. A claim that is an interpretation rather than a documented fact is marked
  **[interpretation]** and says what it is interpreting from.
- **A library that publishes no compatibility matrix gets an interpretation, not an invention.**
  ClickHouse (no client library at all) and Kafka (a floor of 0.8.0 that no modern container can
  serve) are both in that category; §3 states the interpretation and the source it derives from.
- **The published minimum is the verified minimum.** Whatever the UI note says must be a version the
  suite actually runs green against after §6. If 4.2 fails for Mongo, the note says 4.4 (or
  whatever does pass) and §3 records why.

---

## 1. What the code does today

### 1.1 Ten adapters, six client libraries, one of them absent

**[verified in source]** `apps/kira-studio/internal/adapters/` holds ten adapter packages plus three
support packages (`awscfg`, `testsupport`, and the shared root files). `mysql/` and `mariadb/` are
thin profiles over the shared `mysqlfamily/` core (`docs/ARCHITECTURE.md:152-187`), so they share a
driver and a conformance file.

| Adapter package | Client library (exact import) | Version in `go.mod` |
|---|---|---|
| `postgres` | `github.com/jackc/pgx/v5` (`postgres/client.go:9`) | `v5.10.0` (`go.mod:16`) |
| `mysqlfamily` (+ `mysql`, `mariadb`) | `github.com/go-sql-driver/mysql` (`mysqlfamily/client.go:13`) | `v1.10.0` (`go.mod:12`) |
| `sqlite` | `modernc.org/sqlite` — pure Go, **embedded, no server** | `v1.57.0` (`go.mod:31`) |
| `clickhouse` | **none** — `net/http` (`clickhouse/client.go:4`) | n/a |
| `mongo` | `go.mongodb.org/mongo-driver/v2/mongo` (`mongo/client.go:11`) | `v2.8.2` (`go.mod:30`) |
| `redis` | `github.com/redis/go-redis/v9` (`redis/client.go:13`) | `v9.20.0` (`go.mod:18`) |
| `kafka` | `github.com/twmb/franz-go` + `pkg/kadm` (`kafka/client.go:12-13`) | `v1.21.6` / `kadm v1.18.0` (`go.mod:26-27`) |
| `sqs` | `github.com/aws/aws-sdk-go-v2/service/sqs` (`sqs/client.go:7`) | `v1.48.1` (`go.mod:10`) |
| `s3` | `github.com/aws/aws-sdk-go-v2/service/s3` (`s3/client.go:7`) | `v1.109.1` (`go.mod:9`) |

The ClickHouse row is the one that changes how this phase has to think. `clickhouse/client.go`'s own
header comment says it: *"Handle is client.ts's ClickHouseHandle — B11: a plain `*http.Client`, no
ClickHouse driver at all."* There is no third-party compatibility statement to cite; what the app
requires of a ClickHouse server is exactly the set of HTTP-interface settings `fixedSettings`
(`clickhouse/client.go:31-37`) sends on every request — `default_format`,
`output_format_json_validate_utf8`, `show_table_uuid_in_table_create_query_if_not_nil`,
`date_time_output_format`, `output_format_json_quote_64bit_integers` — plus the
`JSONCompactStringsEachRowWithNamesAndTypes` output format. ClickHouse's HTTP interface rejects an
unknown setting outright rather than ignoring it, so the floor is "the release where the newest of
those five settings exists", and there is no page that states that per-setting.

### 1.2 The conformance suites, and the fixture harness underneath them

**[verified in source]** AGENTS.md:80-87 names
`internal/adapters/{postgres,mysqlfamily,sqlite,clickhouse}/*_test.go` as the sole successors to the
deleted `packages/db-fixtures/*.spec.ts` files. That list is now understated — every one of the ten
adapters has a per-capability conformance file of the same shape:

| Package | Conformance file | Lines | Container fixture |
|---|---|---|---|
| `postgres` | `postgres_test.go` | 1088 | `testsupport.StartPostgres` |
| `mysqlfamily` | `mysqlfamily_test.go` | 894 | `StartMariadb` **and** `StartMysql` (one binary, two containers) |
| `sqlite` | `sqlite_test.go` | 785 | `StartSqlite` — a `t.TempDir()` file, no container |
| `clickhouse` | `clickhouse_test.go` (+ `catalog_test.go`) | 537 | `StartClickHouse` |
| `mongo` | `mongo_test.go` (+ `read_internal_test.go`, `literal_test.go`) | 894 | `StartMongo` |
| `redis` | `redis_test.go` (+ `catalog_test.go`, `client_test.go`, `console_test.go`) | 655 | `StartRedis` |
| `kafka` | `kafka_test.go`, `read_test.go`, `main_test.go` | 958 | `StartKafka` |
| `sqs` | `sqs_test.go` | 522 | `StartSqs` (LocalStack) |
| `s3` | `s3_test.go` | 780 | `StartS3` (LocalStack) |

Every container fixture follows one shape (`testsupport/fixture.go`): a package-level
`fixture[T]` memo, started lazily on first `Start*` call, reused by every test in that binary, and
terminated exactly once from the package's own `TestMain` after `m.Run()` (`postgres_test.go:32-35`,
`mysqlfamily_test.go:32-36`, and the seven others). Every `Start*` calls `IsDockerAvailable()` first
and `t.Skip`s with `DockerUnavailableMessage` when the daemon is unreachable
(`testsupport/postgres.go:30-36`, `:73-76`) — which is what lets `ci.yml`'s `checks` job run
`bun run test:go` on a macOS runner with no Docker at all.

**This one-container-per-binary shape is exactly what makes P16 cheap.** Pointing a whole
conformance suite at a different server is one environment variable and one `go test` invocation —
there is nothing per-test to parameterise.

### 1.3 Where the version is pinned today — eight constants, one per kind

**[verified in source]**, one pinned image per kind, all in `testsupport/`:

| Kind | Constant | Value | File:line |
|---|---|---|---|
| postgres | `image` (unexported) | `postgres:17-alpine` | `postgres.go:56` |
| mysql | `mysqlImage` | `mysql:8.4` | `mysql.go:29` |
| mariadb | `mariaImage` | `mariadb:11.4` | `mariadb.go:29` |
| clickhouse | `clickhouseImage` | `clickhouse/clickhouse-server:26.3` | `clickhouse.go:31` |
| mongodb | `MongoImage` (exported) | `mongo:7` | `mongo.go:23` |
| redis | `RedisImage` (exported) | `redis:7` | `redis.go:19` |
| kafka | `kafkaImage` | `confluentinc/cp-kafka:8.0.7` | `kafka.go:29` |
| sqs + s3 | `LocalStackImage` (exported) | `localstack/localstack:3` | `localstack.go:20` |

Three are exported and five are not — an inconsistency P16 resolves by routing all eight through one
accessor rather than by exporting the other five (D2).

The TypeScript fixture harness still pins its own copies for `apps/kira-studio/tests/e2e-real/`:
`packages/db-fixtures/support/postgres.ts:10` (`postgres:17-alpine`), `mariadb.ts:10`
(`mariadb:11.4`), `kafka.ts:17` (`confluentinc/cp-kafka:8.0.7`). Those are deliberately **out of
scope**: `e2e-real` is a wiring tier that spot-checks a scenario or two per kind
(`AGENTS.md:83-84`), not a conformance suite, and running *it* twice per kind would double the
slowest tier in the repo for no version coverage the Go suites don't already give.

### 1.4 Six version assertions that hard-pin today's image

**[verified in source]** — the single most important finding for the implementer, because every one
of these fails on **both** ends of its own range:

| File:line | Regex | Fails on min | Fails on max |
|---|---|---|---|
| `postgres/postgres_test.go:24` | `^PostgreSQL 17` | yes (14) | yes (18) |
| `mysqlfamily/mysqlfamily_test.go:128` | `^MySQL 8\.` | no (8.0) | yes (9.7) |
| `mongo/mongo_test.go:37` | `^MongoDB 7` | yes (4.x) | yes (8.3) |
| `redis/redis_test.go:37` | `^Redis 7` | no (7.0) | yes (8.8) |
| `mysqlfamily/mysqlfamily_test.go:123` | `^MariaDB \d+\.` | no | no |
| `clickhouse/clickhouse_test.go:75` | `^ClickHouse \d+\.` | no | no |
| `sqlite/sqlite_test.go:66` | `^SQLite 3\.` | n/a | n/a |

The last three are already version-agnostic, which is the shape the first four should have had —
except that going all the way to `\d+` throws away the only assertion in the suite that proves the
container is the version the runner asked for. D4 keeps the assertion and derives it.

### 1.5 How tests are invoked today, and what "regular CI" means here

**[verified in source]** `package.json:24` — `"test:go": "go test ./..."` — is the only Go test
entry point, and `.github/workflows/ci.yml` calls it from two jobs: `checks` (macOS, no Docker, so
every container case skips itself) and `container-tests` (ubuntu, Docker present, so every container
case really runs). `ci.yml` triggers on `push` to `main`, `pull_request` to `main`, and
`workflow_dispatch`.

**There is no `e2e-real` npm script at all.** `playwright.config.ts:47-58` defines the project;
AGENTS.md:140-143 documents the invocation as `node node_modules/.bin/playwright test
--project=e2e-real` (plain Node, never `bunx`, because of the documented Bun/testcontainers hang);
and nothing in `ci.yml` runs it. **That is the repo's existing precedent for "on-demand": a tier
that exists, is documented, and is simply never wired to a trigger.** P16 follows it and adds one
thing `e2e-real` lacks — a real script, so "on-demand" doesn't mean "reconstruct the command from a
doc" (D5).

### 1.6 The connection-add UI

**[verified in source]** `apps/kira-studio/frontend/src/project/ConnectionDialog.vue` is a two-step
dialog (`:78-82`): step `engine` is a searchable grid of tiles, one per `ConnectionKind`
(`:379-403`); step `details` shows only the chosen engine's fields, with the engine as identity in
the header (`:353-366`).

Per-kind metadata reaching that component today is **three maps and one set**, all local to the
component except one:

- `KIND_LABEL` (`:24-34`) — display name per kind, local.
- `KIND_ACCENT` (`:42-53`) — accent colour per kind, local.
- `SUPPORTED_KINDS` (`:54-64`) — currently all ten, local.
- `DEFAULT_PORT` — **the only one that lives in shared code**, at
  `packages/shared/domain/connection.ts:20-30`, imported at `ConnectionDialog.vue:6` and applied in
  `onKindChange` (`:163-171`).

So there is an established home for kind-keyed metadata that is a *fact about the engine* rather
than a *fact about this component's presentation*: `packages/shared/domain/connection.ts`, beside
`DEFAULT_PORT`. A minimum supported server version is exactly that kind of fact.

For the note's presentation there are two existing patterns in the same file: `MessageStrip`
(`:594-605`, tones `warn`/`err` only — `MessageStrip.vue:11`) and plain inline notes
(`.uri-note` at `:537`/`:771`, `.credential-note` at `:589`/`:788`). A minimum-version statement is
neither a warning nor an error, so it takes the plain-note shape (D9).

**Nothing in the repo states a supported server version today** — **[verified here]**, a grep for
"minimum", "supported version" and per-engine version claims across `README.md` and
`docs/ARCHITECTURE.md` returns nothing. This phase creates the claim, which is why §6's real run
matters: the number in the UI is a promise.

---

## 2. Findings

### F1 — pgx states its Postgres range in prose *and* proves it in CI; both agree on 14-18

**[verified in source]**, `$(go env GOPATH)/pkg/mod/github.com/jackc/pgx/v5@v5.10.0/README.md:95`:

> *"pgx supports the same versions of Go and PostgreSQL that are supported by their respective
> teams. … for [PostgreSQL] the major releases in the last 5 years. This means pgx supports Go 1.25
> and higher and PostgreSQL 14 and higher."*

**[verified in source]**, the same module's `.github/workflows/ci.yml:17`:

```yaml
pg-version: [14, 15, 16, 17, 18, cockroachdb]
```

**[verified upstream]** `https://endoflife.date/api/postgresql.json`: PG 14 EOL 2026-11-12 (still
supported today), PG 18 released 2025-09-25, no PG 19 exists. **[verified here]**
`library/postgres:14-alpine` → 200, `:18-alpine` → 200, `:19` → **404**.

This is the cleanest row in the table: prose, CI, upstream lifecycle and registry all agree.
Confidence **HIGH**.

### F2 — `go-sql-driver/mysql` documents 5.7+/10.5+ and its CI runs ten server versions

**[verified in source]**, `go-sql-driver/mysql@v1.10.0/README.md:48-50`:

> *"Go 1.24 or higher. … MySQL (5.7+) and MariaDB (10.5+) are supported by maintainers."*

**[verified in source]**, `.github/workflows/test.yml:37-48` builds its matrix from a literal Python
list:

```python
mysql = [
    '9.0', '8.4', # LTS
    '8.0', '5.7',
    'mariadb-11.4',  # LTS
    'mariadb-11.2', 'mariadb-11.1',
    'mariadb-10.11', # LTS
    'mariadb-10.6',  # LTS
    'mariadb-10.5',  # LTS
]
```

So the driver's own **exercised** range is MySQL 5.7-9.0 and MariaDB 10.5-11.4. The README's `5.7+`
and `10.5+` have no stated upper bound, which is normal for a wire-protocol driver: the MySQL
client/server protocol is stable, and the driver's CI ceiling is a snapshot of what existed when
v1.10.0 shipped, not a refusal to work with newer servers. **[interpretation]** the max for this
table is therefore the newest *server* release, not the driver's CI ceiling — with the explicit
acceptance that if the newest server breaks something, that is precisely the finding this phase
exists to produce.

### F3 — MySQL's real floor is 8.0, and it is this app's floor, not the driver's

Three independent blockers, all **[verified in source]**:

1. **`mysqlfamily/definition.go:26-28`** joins `information_schema.CHECK_CONSTRAINTS`
   unconditionally, with no MySQL/MariaDB branch:

   ```sql
   FROM information_schema.TABLE_CONSTRAINTS tc
   LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
     ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
   ```

   That view arrived with CHECK constraint enforcement in **MySQL 8.0.16**. On 5.7 the query is an
   unknown-table error, so every definition-view case fails.
2. **`0008_mysql_seed.sql:64`** — `date_a DATE NOT NULL DEFAULT (CURRENT_DATE)` — and **`:76`** —
   `uuid_a CHAR(36) NOT NULL DEFAULT (UUID())`. Expression defaults are **MySQL 8.0.13+**; on 5.7
   `CREATE TABLE wide_table` fails outright and the fixture never seeds.
3. **`0008_mysql_seed.sql:155`** — `WITH RECURSIVE seq(n) AS (…)` — CTEs are **MySQL 8.0+**.

The seed file's own header (`:1-8`) already documents that it was written as a port *of the MariaDB
seed for a modern MySQL*, so this is not an oversight to fix; it is the fixture's design. Making 5.7
reachable means a second seed dialect plus a version branch in `definition.go` — real work with real
risk, for a server that went EOL **2023-10-31** (**[verified upstream]**
`https://endoflife.date/api/mysql.json`). **The floor is 8.0.** OQ-1 records the alternative.

### F4 — MariaDB's real floor is 10.11, for one line in the seed

**[verified in source]** `0002_mariadb_seed.sql:66-67`:

```sql
  -- Native UUID type (MariaDB 10.7+; this fixture pins 11.4) rather than a CHAR(36) stand-in.
  uuid_a        UUID NOT NULL DEFAULT (UUID()),
```

The fixture's own comment states the constraint. `CREATE TABLE wide_table` fails on 10.5 and 10.6.
The remaining version-sensitive constructs in that file are all comfortably below: `CREATE SEQUENCE`
(`:266`) is 10.3+, `seq_1_to_200` (`:144`) is 10.0+, `JSON_ARRAYAGG` is 10.5+.

The first MariaDB LTS at or above 10.7 is **10.11**, and that is also the oldest MariaDB still in
support: **[verified upstream]** (`https://endoflife.date/api/mariadb.json`) 10.5 EOL **2025-06-24**
and 10.6 EOL **2026-07-06** — both already past as of today (2026-09-01) — while 10.11 runs to
2028-02-16. Two independent reasons landing on the same number. Confidence **HIGH**.

### F5 — `go-redis` publishes an explicit supported-version list, and it does not include the image this repo pins

**[verified in source]**, `redis/go-redis/v9@v9.20.0/README.md:16-28`:

> *"## Supported versions — In `go-redis` we are aiming to support the last three releases of Redis.
> Currently, this means we do support: Redis 8.0 … Redis 8.2 … Redis 8.4 … Redis 8.8 …
> Although it is not officially supported, `go-redis/v9` should be able to work with any Redis
> 7.0+."*

So: **officially 8.0-8.8, unofficially 7.0+.** The repo pins `redis:7` (`testsupport/redis.go:19`),
which resolves to the newest 7.x — i.e. the fixture has been running *below the library's official
floor* the entire time, on the strength of the "should work with 7.0+" sentence. That is fine and it
works, but it is worth naming: today's green suite is evidence for the unofficial floor, not the
official one.

**[verified upstream]** `https://endoflife.date/api/redis.json` shows 8.10 shipped 2026-07-29 —
newer than anything the v9.20.0 README lists — and **[verified here]** `library/redis:8.10` → 200.
The ceiling here is deliberately the **library's** claim (8.8), not the newest image: the SPEC asks
for the versions the client library supports, and 8.10 postdates this pinned library version. §8
hands 8.10 forward for P19.

**[verified here]** `library/redis:7.0` → 200, `:8.8` → 200, `:9` → 404.

The adapter's own command surface is far below either floor — `TYPE` (`redis/read.go:30`),
`MEMORY USAGE` (`:58`, Redis 4.0+), `HSCAN`/`SSCAN`/`ZSCAN` (`:171-183`, 2.8+), `XRANGE` (`:307`,
5.0+) — so 7.0 is not a stretch for this app. Confidence **HIGH** on both ends.

### F6 — The Mongo driver states 4.2, and its Evergreen matrix runs 4.2 through `latest`

**[verified in source]** `go.mongodb.org/mongo-driver/v2@v2.8.2/README.md:27`: *"- MongoDB 4.2 and
higher."*

**[verified in source]** the same module ships its full Evergreen config;
`.evergreen/config.yml:1526-1560` declares the version axis `8.0, 7.0, 6.0, 5.0, 4.4, 4.2, rapid,
latest`, and `:1959` runs the main suite across `["4.2", "4.4", "5.0", "6.0", "7.0", "8.0"]`. The
`latest`/`rapid` entries (`:1975`, `:2022`) are what cover releases newer than 8.0.

**[verified upstream]** `https://endoflife.date/api/mongodb.json`: 8.3 released **2026-05-31** (EOL
2029-10-31) is the newest cycle; 8.2 is a rapid release EOL 2026-07-31; 4.2 went EOL 2023-04-30.
**[verified here]** `library/mongo:4.2`, `:4.4`, `:8.0`, `:8.2`, `:8.3` all → 200; `:9` → 404.

**Min = 4.2** (the driver's documented and CI-covered floor), **max = 8.3** (newest GA, covered
upstream by the `latest` axis). Confidence **HIGH** on the ceiling, **MEDIUM** on 4.2 — the fixture
(`testsupport/mongo.go:71-88`) relies on the two-boot `MONGO_INITDB_ROOT_USERNAME` behaviour and a
`createUser` with roles on two databases, and neither has ever been exercised on a 4.x image here.
§6's run decides; if 4.2 fails for a genuine server-version reason the published floor becomes 4.4
and §3 records it.

### F7 — franz-go's stated floor (0.8.0) is real but unreachable by container, so the Kafka floor is a harness floor

**[verified in source]** `twmb/franz-go@v1.21.6/README.md:14` — *"This library aims to provide every
Kafka feature from Apache Kafka v0.8.0 onward"* — and `:21` — *"Feature complete client (Kafka >=
0.8.0 through v4.2+)"*.

That is an honest and unusually wide claim, and it is useless as a container floor: Kafka 0.8-2.x
need ZooKeeper, and **[verified in source]** the `testcontainers-go` Kafka module this repo uses is
KRaft-only by construction (F9). Its own version guard
(`modules/kafka@v0.44.0/kafka.go:195-228`) refuses anything below `v7.4.0` — but only for
`confluentinc/confluent-local`; for any other image name it returns `nil` and lets the container try
(`:210-215`).

**[interpretation]** the Kafka floor is therefore **the oldest image the existing harness can
actually start**, stated as such: `confluentinc/cp-kafka:7.4.0`, the first Confluent Platform
release the module's own guard admits. Confidence **MEDIUM** — 7.4.0 has never been started here,
and the starter script's `kafka-storage format` path is the risk. §6 proves or disproves it.

The ceiling is firm: **[verified upstream]** Confluent Platform 8.3.0 is built on Apache Kafka 4.3.0
(`https://www.confluent.io/blog/introducing-confluent-platform-8-3/`), Kafka 4.3 released 2026-05-20
(`https://endoflife.date/api/apache-kafka.json`), and **[verified here]**
`confluentinc/cp-kafka:8.3.0` → 200. That is comfortably inside franz-go's "through v4.2+".

### F8 — ClickHouse has no client library, so its bounds come from ClickHouse's own release policy

**[verified in source]** `clickhouse/client.go:4-9` imports `net/http` and `net/url`; the file's own
comment at `:38` says *"B11: a plain `*http.Client`, no ClickHouse driver at all"*, matching
`docs/ARCHITECTURE.md:217-225`.

**[verified upstream]** ClickHouse's own production FAQ
(`https://clickhouse.com/docs/faq/operations/production`) states the policy in full:

> stable releases are *"released roughly monthly … and three latest stable releases are supported in
> terms of diagnostics and backporting of bug fixes"*; LTS releases are *"released twice a year and
> are supported for a year after their initial release."*

**[verified upstream]** `https://endoflife.date/api/clickhouse.json` gives the concrete dates:
26.8 (LTS, released 2026-08-27, supported to 2027-08-27), 26.7, 26.6 (the three latest stable),
26.3 (LTS, released 2026-03-26, supported to 2027-03-26), 25.8 (LTS, support **ended 2026-08-29**),
25.3 (LTS, support ended 2026-03-20).

Read strictly, the oldest in-support ClickHouse today is **26.3** — which is exactly what this repo
already pins (`testsupport/clickhouse.go:31`). A min/max pair of 26.3/26.8 is five months apart and
would find nothing.

**[interpretation]** the ClickHouse floor is set to **25.3 LTS** instead, one full LTS cycle below
the policy window, for three stated reasons: (a) a strictly policy-derived floor moves every quarter
and would make the UI note churn on a schedule nobody is watching; (b) 25.3 is the oldest LTS whose
image is still pullable (**[verified here]** `clickhouse/clickhouse-server:25.3` → 200) and is
realistically still deployed; (c) every setting the adapter sends
(`clickhouse/client.go:31-37`) and the `JSONCompactStringsEachRowWithNamesAndTypes` format all
predate 25.x by years — the newest of them, the JSON UTF-8 validation family, dates to the 2022
changelog (`https://clickhouse.com/docs/whats-new/changelog/2022`). Confidence **MEDIUM**; this is
the row most likely to move after §6.

Ceiling: **26.8** (**[verified here]** → 200; `:26.9` and `:27.1` → 404, so 26.8 is genuinely the
newest published tag).

### F9 — The Kafka module's starter script is Confluent-specific, so `apache/kafka` images are out

**[verified in source]** `testcontainers-go/modules/kafka@v0.44.0/kafka.go:21-30`:

```bash
source /etc/confluent/docker/bash-config
export KAFKA_ADVERTISED_LISTENERS=%s,BROKER://%s:9092
sed -i '/KAFKA_ZOOKEEPER_CONNECT/d' /etc/confluent/docker/configure
echo 'kafka-storage format --ignore-formatted …' >> /etc/confluent/docker/configure
/etc/confluent/docker/configure
/etc/confluent/docker/launch
```

Every path in it is Confluent's image layout. `apache/kafka:*` images (which **[verified here]**
exist all the way to `4.3.0`) have none of those files, so swapping the image name would fail at
`source`. The Kafka compat matrix stays inside `confluentinc/cp-kafka`, and the CP→Kafka mapping is
stated in §3 so the row is still readable as Kafka versions.

### F10 — SQS and S3 have no server version; LocalStack's major is the honest substitute

`aws-sdk-go-v2` targets AWS's own versionless service APIs. There is no "minimum supported Amazon
SQS version" to state, and the two conformance suites reach a LocalStack container
(`testsupport/localstack.go:33-56`) precisely because there is no real server to version.

**[verified here]** `localstack/localstack:3` → 200, `:4` → 200, `:5` → **404**, `:latest` → 200. The
repo pins `:3` (`localstack.go:20`) while `:4` is the current major — a genuinely stale pin, and one
that has a real behavioural surface for this app: `docs/ARCHITECTURE.md:347-349` records that the S3
adapter's `x-amz-meta-*` handling was verified *against a live LocalStack container*, i.e. against
emulator behaviour that can change between majors.

**Decision (D7):** SQS and S3 are **in** the suite, running LocalStack 3 and 4, and **out** of the
UI's minimum-version note — the note map is a `Partial<Record<…>>` and simply has no entry for them.
Claiming "minimum Amazon SQS version" in a dialog would be a fabrication.

### F11 — SQLite has no server at all

`modernc.org/sqlite` is a pure-Go translation of SQLite compiled into the binary;
**[verified in source]** `modernc.org/sqlite@v1.57.0/lib/sqlite.go:4516` — `const SQLITE_VERSION =
"3.53.3"`. `testsupport/sqlite.go:17` documents the fixture as a temp file, not a container, and
`sqlite_test.go:66` asserts `^SQLite 3\.` — already version-agnostic because there is no server
version to pin.

SQLite is therefore **out of the compat matrix** (nothing to vary) and **in the UI note** with
different wording: what a user needs to know is which *file format* the app reads, and the answer —
SQLite 3, unchanged since 2004, via a bundled 3.53.3 engine — is genuinely useful in the dialog
where they are about to pick a `.sqlite` file.

### F12 — The existing default images are three versions stale, and P16 must not fix that

**[verified here]** against the registry: `mongo:7` (7.0, EOL 2027-08-31) while 8.3 is current;
`redis:7` while go-redis officially supports 8.0-8.8; `localstack/localstack:3` while 4 is current.
`postgres:17-alpine`, `mysql:8.4`, `mariadb:11.4`, `clickhouse/clickhouse-server:26.3` and
`cp-kafka:8.0.7` are all reasonable current-ish pins.

Bumping the defaults is P19's row in SPEC.md (`docs/v1.1/SPEC.md:34`). P16 records the observation
in §8 and changes nothing, because changing a default pin changes what *regular* CI runs, which is
exactly what this phase is scoped not to touch.

### F13 — `go test`'s result cache will silently reuse a run across image overrides unless forced

Go's test cache keys on the files and environment variables a test observes. `os.Getenv` calls made
during a test binary's run are tracked, but the fixture's own memoisation means a *skipped* run (no
Docker) may never read the variable at all, and a package whose test binary is unchanged can be
served from cache with a stale result. **The driver script must pass `-count=1`** on every
invocation. Cheap, and the alternative is a compat run that reports green without starting a
container.

---

## 3. The version table

**This is the deliverable the rest of the phase is built against.** Every image was probed against
the Docker Hub registry API **[verified here]** on 2026-09-01.

Legend: **Lib min/max** is what the client library itself documents or exercises (F1-F8). **Suite
min/max** is what the on-demand suite actually runs, which differs where this app's own code or
fixtures are stricter (F3, F4) or where the library states a bound no container can serve (F7).

| Kind | Client library @ version | Lib min (source) | Lib max (source) | **Suite MIN image** | **Suite MAX image** | Why suite ≠ lib | Conf. |
|---|---|---|---|---|---|---|---|
| **postgres** | `jackc/pgx/v5` v5.10.0 | **14** — README:95; CI matrix `[14,15,16,17,18]` | **18** — same CI matrix; PG 19 does not exist | `postgres:14-alpine` | `postgres:18-alpine` | — (identical) | HIGH |
| **mariadb** | `go-sql-driver/mysql` v1.10.0 | **10.5** — README:49; CI `mariadb-10.5` | **11.4** in CI; **12.3** is current LTS | `mariadb:10.11` | `mariadb:12.3` | Floor raised: `0002_mariadb_seed.sql:67` needs native `UUID` (10.7+); 10.5/10.6 also EOL. Ceiling raised past CI to the current LTS (F2) | HIGH |
| **mysql** | `go-sql-driver/mysql` v1.10.0 | **5.7** — README:49; CI `5.7` | **9.0** in CI; **9.7** is current LTS | `mysql:8.0` | `mysql:9.7` | Floor raised: `definition.go:26-28` needs `information_schema.CHECK_CONSTRAINTS` (8.0.16+); seed needs expression defaults (8.0.13+) and CTEs (8.0+). 5.7 EOL 2023-10-31 | HIGH |
| **sqlite** | `modernc.org/sqlite` v1.57.0 (SQLite 3.53.3) | n/a — embedded | n/a | **not in matrix** | **not in matrix** | No server exists to vary (F11) | HIGH |
| **clickhouse** | **none** — `net/http` | **25.3 LTS** (interpretation, F8) | **26.8 LTS** — newest published tag | `clickhouse/clickhouse-server:25.3` | `clickhouse/clickhouse-server:26.8` | No client library; bounds derive from ClickHouse's own policy, floor deliberately one LTS below the policy window | MED |
| **mongodb** | `mongo-driver/v2` v2.8.2 | **4.2** — README:27; Evergreen `:1959` | **8.0** explicit + `latest`/`rapid` axes | `mongo:4.4` | `mongo:8.3` | Floor raised past the library's own 4.2 by §6's real run: `insert`/`delete` commands reject the `comment` field on 4.2 (`(Location40415) BSON field 'insert.comment' is an unknown field`) — `comment` on write commands is 4.4+ only, and every mutate call in this adapter sends one for cancel/kill-op correlation. Ceiling is newest GA (covered upstream by `latest`) | HIGH max / HIGH min |
| **redis** | `redis/go-redis/v9` v9.20.0 | **8.0** official / **7.0** unofficial — README:20,28 | **8.8** — README:23 | `redis:7.0` | `redis:8.8` | Floor is the README's own explicit unofficial statement; ceiling is the library's claim, not the newest image (8.10 exists) | HIGH |
| **kafka** | `twmb/franz-go` v1.21.6 | **0.8.0** — README:14,21 | **4.2+** — README:21 | `confluentinc/cp-kafka:7.4.0` (= Kafka 3.4) | `confluentinc/cp-kafka:8.3.0` (= Kafka 4.3.0) | Floor is a harness floor: the testcontainers module is KRaft-only and Confluent-image-specific (F7, F9). ZooKeeper-era Kafka is unreachable by this harness at any effort worth spending | MED min / HIGH max |
| **sqs** | `aws-sdk-go-v2/service/sqs` v1.48.1 | n/a — AWS is versionless | n/a | `localstack/localstack:3` | `localstack/localstack:4` | LocalStack major stands in for "the emulator we test against"; **no UI note** (F10, D7) | HIGH |
| **s3** | `aws-sdk-go-v2/service/s3` v1.109.1 | n/a — AWS is versionless | n/a | `localstack/localstack:3` | `localstack/localstack:4` | same as SQS | HIGH |

**Registry probes, in full** (**[verified here]**, 200 unless noted):
`postgres:14-alpine`, `postgres:17-alpine`, `postgres:18-alpine`, `postgres:19` **404** ·
`mariadb:10.5`, `10.6`, `10.11`, `11.4`, `11.8`, `12.0`, `12.1`, `12.2`, `12.3`, `12.4` **404**,
`13.0` **404** · `mysql:5.7`, `8.0`, `8.0.46`, `8.4`, `8.4.11`, `9.0`…`9.6`, `9.7`, `9.7.2`,
`10.0` **404** · `clickhouse/clickhouse-server:23.8`, `24.3`, `24.8`, `25.3`, `25.8`, `26.3`,
`26.6`, `26.8`, `26.9` **404**, `27.1` **404** · `mongo:4.2`, `4.4`, `5.0`, `6.0`, `7`, `8.0`,
`8.2`, `8.3`, `9` **404** · `redis:7.0`, `7.4`, `8.0`, `8.2`, `8.4`, `8.8`, `8.10`, `9` **404** ·
`confluentinc/cp-kafka:7.4.0`, `7.5.0`, `7.6.0`, `7.9.0`, `8.0.7`, `8.1.0`, `8.2.0`, `8.3.0` ·
`apache/kafka:3.7.0`…`4.3.0` (all 200 — unusable per F9) ·
`localstack/localstack:3`, `3.0`, `4`, `4.0`, `latest`, `2` **404**, `5` **404**.

**Confluent Platform → Apache Kafka mapping** used above: CP `7.x` → Kafka `3.x` (CP 7.4 → 3.4,
CP 7.9 → 3.9), CP `8.x` → Kafka `4.x`. **[verified upstream]** for the ceiling: CP 8.3.0 is built on
Apache Kafka 4.3.0.

**Published minimums for the UI note** (D8), derived from the Suite MIN column:

| Kind | Note text |
|---|---|
| postgres | `Requires PostgreSQL 14 or newer.` |
| mariadb | `Requires MariaDB 10.11 or newer.` |
| mysql | `Requires MySQL 8.0 or newer.` |
| clickhouse | `Requires ClickHouse 25.3 or newer.` |
| mongodb | `Requires MongoDB 4.4 or newer.` |
| redis | `Requires Redis 7.0 or newer.` |
| kafka | `Requires Apache Kafka 3.4 or newer.` |
| sqlite | `Reads any SQLite 3 database file — no server required.` |
| sqs | *(no entry)* |
| s3 | *(no entry)* |

**These numbers are provisional until §6 runs.** Any row §6 disproves is corrected *here*, in this
table, in the same commit that fixes it — this document is the record.

---

## 4. Decisions

### D1 — The compat suite reuses the existing conformance packages verbatim; it is a *runner*, not a new tier

SPEC.md is explicit: *"the same coverage that exists today, just run against the version extremes."*
So there is no new `*_test.go` file, no `//go:build compat` tag over a duplicated suite, and no
second assertion set. `go test ./apps/kira-studio/internal/adapters/postgres/...` is the compat
suite; the only thing P16 adds is a way to tell it which image to start.

Rejected: a build-tagged parallel suite. It would drift from the real one within a phase or two, and
AGENTS.md:80-87 is emphatic that the conformance suites are *the* per-capability coverage — a second
copy would immediately violate that.

### D2 — One image-override accessor in `testsupport`, keyed by kind, defaulting to today's pin

New file `apps/kira-studio/internal/adapters/testsupport/images.go`:

```go
// ImageFor returns the container image for kind. An on-demand compatibility run (P16,
// scripts/db-compat.sh) overrides the pinned default through KIRA_COMPAT_IMAGE_<KIND>; with the
// variable unset every caller gets exactly the image it pinned before P16, so `bun run test:go`
// and CI are unchanged.
func ImageFor(kind, pinned string) string
```

- Kind keys: `POSTGRES`, `MYSQL`, `MARIADB`, `CLICKHOUSE`, `MONGO`, `REDIS`, `KAFKA`, `LOCALSTACK`.
- Every one of the eight pin sites from §1.3 changes from a bare constant reference to
  `ImageFor("postgres", defaultPostgresImage)` and friends. The three exported constants
  (`MongoImage`, `RedisImage`, `LocalStackImage`) keep their names — they have out-of-package
  callers — but become the *default*, with the resolved value obtained through `ImageFor`.
- An empty or unset variable means "use the pin". Whitespace is trimmed; nothing else is validated,
  because a bad image name should fail loudly at container start with the registry's own error, not
  be second-guessed by a regex here.

Why an env var rather than a Go flag: the fixtures are started from `TestMain`-scoped memos across
nine packages, and a flag would need registering and threading in every one of them. An env var is
read where the image is resolved, once, and needs no plumbing.

### D3 — The compat run is one `go test` invocation per (kind, extreme), never a matrix inside one binary

`mysqlfamily_test.go` starts **two** containers in one binary (MariaDB and MySQL,
`:32-36`), and both memos are process-wide. Trying to run "MariaDB 10.11 and 12.3" inside one binary
would mean tearing down and restarting a memoised fixture mid-run — exactly the bug
`fixture.go`'s doc comment already warns about. So: one process per pair, image chosen before the
process starts. For `mysqlfamily` that means each invocation sets *both* `KIRA_COMPAT_IMAGE_MYSQL`
and `KIRA_COMPAT_IMAGE_MARIADB` (min-with-min, max-with-max), which is also the cheaper shape —
four containers across two runs instead of four runs.

Resulting run list — **16 `go test` invocations, 18 container starts**:

| # | Package | `KIRA_COMPAT_IMAGE_*` | Containers |
|---|---|---|---|
| 1-2 | `postgres` | `POSTGRES=postgres:14-alpine` / `:18-alpine` | 2 |
| 3-4 | `mysqlfamily` | `MARIADB=mariadb:10.11` + `MYSQL=mysql:8.0` / `mariadb:12.3` + `mysql:9.7` | 4 |
| 5-6 | `clickhouse` | `CLICKHOUSE=…:25.3` / `…:26.8` | 2 |
| 7-8 | `mongo` | `MONGO=mongo:4.4` / `mongo:8.3` | 2 |
| 9-10 | `redis` | `REDIS=redis:7.0` / `redis:8.8` | 2 |
| 11-12 | `kafka` | `KAFKA=confluentinc/cp-kafka:7.4.0` / `:8.3.0` | 2 |
| 13-14 | `sqs` | `LOCALSTACK=localstack/localstack:3` / `:4` | 2 |
| 15-16 | `s3` | `LOCALSTACK=localstack/localstack:3` / `:4` | 2 |

`sqlite` is absent by design (F11).

### D4 — The server-version assertion is derived from the resolved image tag, not relaxed

`testsupport/images.go` also exports:

```go
// ServerMajor returns the major-version component of the image tag resolved for kind ("17" for
// postgres:17-alpine, "12" for mariadb:12.3, "8" for mongo:8.3), or "" when the tag carries no
// leading number (":latest", a digest pin). Conformance suites build their own ServerVersion
// assertion from it, so running against a different image still asserts the version that was
// actually asked for instead of asserting nothing.
func ServerMajor(kind, pinned string) string
```

Parsing rule, in order: take the text after the last `:`; if there is none, return `""`; drop any
`-suffix` (`17-alpine` → `17`); take the leading `\d+`; return `""` if there is none.

Each of the four hardcoded regexes becomes a composed one:

| File:line | Today | After |
|---|---|---|
| `postgres_test.go:24` | `^PostgreSQL 17` | `^PostgreSQL <major>\.` (fallback `^PostgreSQL \d+\.`) |
| `mysqlfamily_test.go:128` | `^MySQL 8\.` | `^MySQL <major>\.` |
| `mongo_test.go:37` | `^MongoDB 7` | `^MongoDB <major>\.` |
| `redis_test.go:37` | `^Redis 7` | `^Redis <major>\.` |

`mariadb`'s `^MariaDB \d+\.` (`:123`), ClickHouse's `^ClickHouse \d+\.` (`clickhouse_test.go:75`)
and SQLite's `^SQLite 3\.` (`sqlite_test.go:66`) become composed the same way where a major is
derivable, which *strengthens* two of them — `mariadb:12.3` will now be asserted as MariaDB 12,
which it never was before.

**This is the one place P16 changes an assertion, and it makes it stricter, not looser.**

### D5 — `scripts/db-compat.sh` is the on-demand entry point, plus one `package.json` script

Following `scripts/verify-packaging.sh`'s house style (`#!/bin/sh`, `set -eu`, a header comment
naming the plan section it implements, every check run before exit so one run reports everything).

```
scripts/db-compat.sh [--only <kind>] [--min|--max] [--mirror] [--no-pull]
```

- The matrix from D3 lives in the script as a plain newline-delimited list — `kind|extreme|package|env assignments` — one line per invocation, easy to read and to diff against §3.
- `--mirror` implements AGENTS.md:118-135 verbatim: for each image, `docker pull
  mirror.gcr.io/<library/>?<name>:<tag>` then `docker tag … <plain name>`, inserting `library/`
  **only** for unnamespaced official images (`postgres`, `mysql`, `mariadb`, `mongo`, `redis`) and
  never for already-namespaced ones (`clickhouse/clickhouse-server`, `confluentinc/cp-kafka`,
  `localstack/localstack`). This flag is what makes the suite runnable in this sandbox at all.
- Every invocation is `go test -count=1 -timeout 30m <package>` (F13 for `-count=1`; the timeout
  because a cold `cp-kafka:7.4.0` pull plus KRaft format plus the 958-line suite can exceed Go's
  10-minute default).
- **No `set -e` abort between pairs.** Each pair's exit status is recorded and the script prints a
  final `kind  extreme  image  PASS/FAIL` table, exiting non-zero if any failed. A run that dies on
  the first old MySQL is worth much less than one that tells you all sixteen results.
- `package.json` gains `"test:compat": "sh scripts/db-compat.sh"`. **It is referenced by no CI job.**
  A script in `package.json` is not a trigger; `ci.yml` enumerates what it runs explicitly
  (`:37-42`, `:70`, `:91-93`), so adding an entry cannot make it run.

### D6 — The workflow is `workflow_dispatch`-only, and says so in its own name

`.github/workflows/db-compat.yml`:

```yaml
name: DB compatibility (on demand)
on:
  workflow_dispatch:
    inputs:
      kind:    { description: 'Single kind, or "all"', default: 'all' }
      extreme: { description: 'min | max | both',      default: 'both' }
```

One `ubuntu-latest` job (Docker is present on that runner, which is why `ci.yml` puts
`container-tests` there), `timeout-minutes: 120`, no `push`/`pull_request`/`schedule` trigger of any
kind. It runs `sh scripts/db-compat.sh` with the inputs mapped to flags — **without** `--mirror`,
since GitHub's runners reach Docker Hub directly and the mirror workaround is a sandbox-only need.

Rejected: adding a job to `ci.yml` guarded by `if: github.event_name == 'workflow_dispatch'`. It
would run on every manual re-run of ordinary CI, which is not "on demand" in the sense the SPEC
means, and it would put a two-hour job in the same file as a fifteen-minute one.

### D7 — SQS and S3 run in the suite but get no UI version note

F10. The map is `Partial<Record<ConnectionKind, string>>` and the template's `v-if` handles absence,
so this costs nothing structurally and avoids stating a number that does not exist.

### D8 — `MIN_SERVER_VERSION` lives beside `DEFAULT_PORT` in shared code, not in the component

`packages/shared/domain/connection.ts`, immediately after `DEFAULT_PORT` (`:20-30`):

```ts
// P16: the minimum server version each adapter's client library (and this app's own catalog SQL)
// actually supports — the verified floor of the on-demand compatibility suite
// (docs/v1.1/plans/P16-db-compat-suite.md §3), not a marketing claim. SQS/S3 have no server
// version at all (AWS's APIs are versionless), so they have no entry.
export const MIN_SERVER_VERSION: Partial<Record<ConnectionKind, string>> = { … };
```

The values are the note strings from §3's second table. Two reasons this belongs in shared code and
not in `ConnectionDialog.vue` beside `KIND_LABEL`: it is a fact about the engine rather than about
this dialog's presentation (the same test `DEFAULT_PORT` already passes), and a second consumer is
plausible — a connection's detail/definition surface, or a future connect-time check (OQ-2) — where
a component-local constant would have to be duplicated.

### D9 — The note renders as a plain inline note on step 2, not a `MessageStrip`

`MessageStrip.vue:11` offers `warn` and `err` only, and its own comment records that a third tone
was deliberately not added. A minimum-version statement is informational, so it takes the shape the
file already uses for informational text — the `.uri-note`/`.credential-note` pattern
(`ConnectionDialog.vue:537`, `:589`).

Placement: **step `details`**, directly under the dialog's field body's first block, so it is visible
the moment a kind is chosen and while the user is filling in host/port — the moment the number is
actionable. Not on step `engine`: ten notes across ten tiles is noise, and the tiles already carry a
tooltip (`:389`).

`data-testid="connection-min-version"`, matching the file's existing testid convention
(`connection-credential-note`, `connection-kind-<kind>`).

### D10 — A failing extreme is fixed in the adapter, or skipped with the server's own reason named

When §6 turns up a failure, exactly three dispositions are allowed, and every one of them is written
into §3/§6 of this document:

1. **An adapter bug** — the app assumed behaviour only newer/older servers have. Fix the adapter.
   This is the outcome the phase exists to produce.
2. **A genuine server-version capability gap** — the feature does not exist on that version at all
   (e.g. a catalog view introduced later). Then either the floor moves up in §3 *with the reason*,
   or the single case gets a `t.Skip` guarded by `ServerMajor` **with a comment naming the server
   version and the missing feature** — never a bare skip.
3. **A fixture-only problem** — the seed, not the adapter, is version-specific. Fix the seed if it
   is cheap and dialect-neutral; otherwise raise the floor (F3/F4 are exactly this, decided ahead of
   the run).

**Weakening an assertion so a version passes is not on the list.** AGENTS.md:56-58.

---

## 5. Implementation order

Six commits, sequential. Commits C1-C4 are the mechanism, C5 is the UI, C6 is the real run — and C6
is where most of the wall clock lives.

### C1 — `test(adapters): resolve every container image through one overridable accessor`

- New `apps/kira-studio/internal/adapters/testsupport/images.go` with `ImageFor` and `ServerMajor`
  (D2, D4), plus a short doc comment naming the env-var scheme and pointing at this plan.
- Rewire all eight pin sites (§1.3). The three exported constants keep their names and become
  defaults.
- **No behaviour change with no env var set** — this commit alone must leave `bun run test:go`
  byte-identical.
- **A unit test is warranted here and only here.** `ServerMajor`'s parsing has several interacting
  lexical rules (`17-alpine`, `12.3`, `clickhouse/clickhouse-server:26.8` — a `:` in the tag
  position but a `/` in the name, `localstack/localstack:latest`, a digest pin with no tag,
  a bare name with no `:`), which is exactly AGENTS.md:62-70's "a parser with several interacting
  lexical rules" category. `ImageFor` itself gets nothing — it is a two-line getenv-or-default.

### C2 — `test(adapters): assert the server version the image actually pins`

- The four regex rewrites from D4, plus composing MariaDB's/ClickHouse's from `ServerMajor` where
  derivable.
- Verified by running `bun run test:go` twice: once bare (must be identical to before), once with
  `KIRA_COMPAT_IMAGE_POSTGRES=postgres:18-alpine` (must now pass where the old regex would fail).

### C3 — `chore(scripts): an on-demand DB version-compatibility runner`

- `scripts/db-compat.sh` per D5, with the sixteen-line matrix and the `--mirror` retag path.
- `package.json`: `"test:compat": "sh scripts/db-compat.sh"`.
- The script's header comment carries the §3 table's provenance in one line and points here.

### C4 — `ci: a manually-triggered DB compatibility workflow`

- `.github/workflows/db-compat.yml` per D6. `ci.yml` is **not** edited.

### C5 — `feat(connections): state each engine's minimum supported server version`

- `MIN_SERVER_VERSION` in `packages/shared/domain/connection.ts` (D8), values from §3.
- `ConnectionDialog.vue`: import it, render the plain note on step `details` (D9).
- One case appended to `apps/kira-studio/tests/ui/connections.spec.ts`: pick PostgreSQL → the note
  reads the expected string; pick S3 → `connection-min-version` is absent; pick SQLite → the
  file-kind wording appears. Three assertions in one spec, not three specs.

### C6 — the real run, and whatever it produces

Not one commit — however many the findings need, each one its own commit per AGENTS.md's
one-finding-one-commit discipline, with §3 and §6 of this document updated in the same commit that
changes a published minimum. §6 is the procedure.

---

## 6. Verification — running it for real

**This step cannot be simulated, and it is the SPEC's own final clause.** It needs a real Docker
daemon, ~18 real container starts, and roughly 12-15 GB of pulled images.

### 6.1 Bringing Docker up in this sandbox

Per AGENTS.md:109-116, once per fresh container, as root:

```
nohup dockerd > /tmp/dockerd.log 2>&1 & disown
```

then poll `docker info` / `/tmp/dockerd.log` for `API listen on /var/run/docker.sock`. **Do
everything in one Bash invocation** (AGENTS.md:266-271 — a process started in one invocation cannot
be signalled from a later one), with a correspondingly long tool timeout.

### 6.2 Pulling through the mirror

AGENTS.md:118-135: Docker Hub blob downloads 403 through this sandbox's proxy;
`mirror.gcr.io` does not. `scripts/db-compat.sh --mirror` does the pull-and-retag for every image in
the matrix. The `library/` rule matters and the script encodes it:

```
docker pull mirror.gcr.io/library/mysql:9.7            && docker tag … mysql:9.7
docker pull mirror.gcr.io/library/mariadb:10.11        && docker tag … mariadb:10.11
docker pull mirror.gcr.io/clickhouse/clickhouse-server:25.3 && docker tag … clickhouse/clickhouse-server:25.3
docker pull mirror.gcr.io/confluentinc/cp-kafka:7.4.0  && docker tag … confluentinc/cp-kafka:7.4.0
docker pull mirror.gcr.io/localstack/localstack:4      && docker tag … localstack/localstack:4
```

**Pull first, all of it, before running anything.** A mid-run pull failure is much harder to read
than a pre-flight one, and `--no-pull` then lets the sixteen test invocations run against a warm
local cache.

### 6.3 Expected wall clock, stated honestly

Rough, from the sizes of the images involved and this repo's own suite timings:

- **Pulls**: ~12-15 GB across 18 tags. ClickHouse (~1 GB each), `cp-kafka` (~800 MB each),
  `localstack` (~1 GB each) and `mysql` (~600 MB each) dominate. Through `mirror.gcr.io`, plan for
  **30-60 minutes**, and note that `mirror.gcr.io` is a read-through cache — the *first* pull of a
  cold tag can be materially slower than a warm one.
- **Runs**: 16 invocations. Postgres/MariaDB/MySQL each seed a 1,000,000-row `big_rows` table
  (`testsupport/postgres.go:132-135`, `mariadb.go` constant `mariaBigRowsCount`), which is the
  single slowest part of any of them. Plan for **40-90 minutes** total.
- **Realistically: two to three hours end to end**, and it will not fit in one Bash tool call.
  Run it in stages — `--only postgres`, `--only mysqlfamily`, … — one kind per invocation, which is
  also what makes a failure legible.

### 6.4 What to expect to break, in rough order of likelihood

Predictions, so the implementer can tell a real finding from a known-shaped one:

1. **`postgres:14` / `postgres:18`** — the version regex (fixed in C2). Beyond that, the pgx path is
   the best-covered in the repo and 14-18 is a well-trodden range; a genuine failure here would be
   in catalog SQL against `pg_` views whose columns moved.
2. **`mysql:9.7`** — the `^MySQL 8\.` regex (C2), and then the real risk: MySQL 9's
   `information_schema` and `SHOW CREATE TABLE` output formatting, which `definition.go` parses.
3. **`mariadb:10.11`** — `performance_schema` is started explicitly by the fixture
   (`mariadb.go` `--performance-schema=ON`) for a `SESSION_CONNECT_ATTRS` case; that table's shape
   is stable back to 10.5, so this should hold, but it is the version-sensitive case in that file.
4. **`mongo:4.2`** — highest-probability genuine floor move. The fixture's wait strategy is the
   double-`"Waiting for connections"` two-boot behaviour (`mongo.go:82-86`); 4.2's log lines differ
   in format from 7.0's (4.4 introduced structured JSON logging, 4.2 is still plain text), so the
   wait strategy may match differently. If it does, D10 case 3 applies: fix the wait strategy if
   cheap, else raise the floor to 4.4 and record it.
5. **`redis:8.8`** — Redis 8's `INFO` output and `MEMORY USAGE` accounting differ from 7's; the
   adapter reads both (`redis/read.go:58`, `catalog.go`). Plausible real finding.
6. **`cp-kafka:7.4.0`** — highest-probability *harness* failure (F7). If the module's starter script
   cannot format storage on 7.4, try 7.5.0 and 7.6.0 in order and record the first that works as the
   floor, with the failure mode named. Do **not** switch to `apache/kafka` (F9).
7. **`localstack:4`** — LocalStack 4's S3 emulation differs from 3's; `docs/ARCHITECTURE.md:347-349`
   records that this adapter's `x-amz-meta-*` handling was verified against a live container, so this
   is a real candidate.
8. **`clickhouse-server:25.3`** — if any of the five `fixedSettings` (`clickhouse/client.go:31-37`)
   is unknown to 25.3, *every* request fails with the server's own `UNKNOWN_SETTING`, which is an
   unmistakable signature. That would move the ClickHouse floor to the first release that knows it,
   and the error text names the setting, so the fix is mechanical.

### 6.5 Recording the result

After the run, in the same commits that carry the fixes:

- **§3's table is corrected** wherever a floor or ceiling moved, with the reason and the server's
  own error text quoted.
- **§3's second table (the UI note strings) and `MIN_SERVER_VERSION` are updated together** — the
  note must never claim a version the suite did not prove.
- A short **"What the first run found"** subsection is appended to §6 listing each finding and the
  commit that fixed it. Per AGENTS.md:91-103 that belongs *here*, in this plan doc, never in
  AGENTS.md.

### 6.6 What must not regress

- `bun run test:go` with no `KIRA_COMPAT_IMAGE_*` set starts exactly the eight images it starts
  today, at exactly today's tags.
- `ci.yml` is unchanged. `bun run lint`, `bun run typecheck`, `bun run build`,
  `bun run verify:packaging` all still pass.
- `bun run test:ui` passes, including the new connection-dialog case.
- No adapter's conformance suite loses a case.

---

## 7. Acceptance checklist

- [ ] Every adapter is enumerated with its exact client library and `go.mod` version (§1.1).
- [ ] Every min/max claim cites a real source — README line, CI config line, upstream URL — or is
      explicitly marked `[interpretation]` with what it interprets from (§3).
- [ ] Every image in §3 was probed against the real registry, including the negatives (§3).
- [ ] `testsupport.ImageFor` routes all eight pins; unset env = today's behaviour, byte for byte.
- [ ] `testsupport.ServerMajor` has a unit test covering `17-alpine`, `12.3`, a namespaced image, a
      `:latest` tag, and a name with no tag.
- [ ] The four hardcoded version regexes are derived, not relaxed; MariaDB's and ClickHouse's are
      now stricter than before.
- [ ] `scripts/db-compat.sh` runs all sixteen pairs, does not abort on the first failure, prints one
      summary table, exits non-zero on any failure, and passes `-count=1`.
- [ ] `--mirror` applies AGENTS.md's `library/` rule correctly for all eight image names.
- [ ] `.github/workflows/db-compat.yml` has `workflow_dispatch` and nothing else; `ci.yml` is
      untouched; no CI job references `test:compat`.
- [ ] `MIN_SERVER_VERSION` lives in `packages/shared/domain/connection.ts` beside `DEFAULT_PORT`;
      SQS and S3 have no entry; SQLite's entry says "no server required".
- [ ] The dialog shows the note on step `details` for a server kind, shows the file wording for
      SQLite, and shows nothing for S3 — asserted in `tests/ui/connections.spec.ts`.
- [ ] **The suite has actually been run against real containers**, all sixteen pairs, and the run's
      results are recorded in §6.5.
- [ ] Every failure the run produced is fixed under D10's three dispositions — none by weakening an
      assertion — and every published minimum in §3 and in `MIN_SERVER_VERSION` is one the run
      proved green.

---

## 8. Open questions, handed forward

- **OQ-1 — A 5.7-compatible MySQL seed and a 10.5-compatible MariaDB seed.** F3/F4 raise both floors
  above what the shared driver documents. Reaching the driver's own floor needs a second seed
  dialect *and* a version branch around `definition.go:26-28`'s `CHECK_CONSTRAINTS` join. Both
  servers are EOL (MySQL 5.7 since 2023-10-31, MariaDB 10.5 since 2025-06-24), so the cost is real
  and the value is low — but it is a genuine gap between "what the driver supports" and "what this
  app supports", and it should be a deliberate decision rather than an accident.
- **OQ-2 — A connect-time version check.** The note is informational. A real check would read
  `ConnectInfo.ServerVersion` (already produced by every adapter — it is what the six regexes assert)
  and warn on connect when the server is below `MIN_SERVER_VERSION`. That is a behaviour change with
  its own UX questions (warn vs. block, per-connection dismissal) and belongs on its own.
- **OQ-3 — Three stale default pins.** F12: `mongo:7` (8.3 is current), `redis:7` (below go-redis's
  own official floor of 8.0), `localstack/localstack:3` (4 is current). P19 owns the bump; P16
  deliberately leaves them, because changing a default changes what regular CI runs.
- **OQ-4 — `redis:8.10` and MariaDB 12.x cadence.** go-redis v9.20.0's README tops out at 8.8 while
  Redis 8.10 shipped 2026-07-29, and MariaDB now ships a new LTS annually. Both ceilings in §3 will
  be stale within two quarters. A `db-compat.sh --check-ceilings` mode that queries the registry and
  reports newer tags than the matrix names would keep §3 honest without a human remembering to
  re-read four READMEs; not built here.
- **OQ-5 — `e2e-real`'s own three pinned images.** `packages/db-fixtures/support/{postgres,mariadb,
  kafka}.ts` pin independently of the Go side and will drift from it. Unifying them means the TS
  harness reading the same env vars, which is cheap — but `e2e-real` is a wiring tier, not a
  conformance one (§1.3), so it buys little version coverage and is left out on purpose.
