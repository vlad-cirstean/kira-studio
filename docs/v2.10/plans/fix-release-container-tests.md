# Fix: Release container tests (Mongo kernel 6.19 gate)

Not a chapter phase; no `SPEC.md` row. One sequential implementer, no stream split (steps share
`testsupport/` and scripts).

## Problem

Release run 39648564438 (tag v0.2.8, `5d2c3d482`) failed `test-matrix (Linux)` (kind mongo) and
`ci-gate` (PR CI run 39647286858, `go-containers (Linux)`). Same cause in both. `mongo:8.3` exits
with code 1 in under 2s:

`MongoDB cannot start: Linux kernel versions 6.19 and newer has a known incompatibility with this version of MongoDB. See https://jira.mongodb.org/browse/SERVER-121912`

Runner pool mixes kernels, so a rerun landing on an older kernel passes. Every other kind passed.

## Evidence (authoritative sources, read 2026-10-21)

- SERVER-121912: tcmalloc in 8.0+ violates the rseq ABI that kernel 6.19 enforces. Closed "Gone
  away", no fix version. Fixed-by link: SERVER-125742.
- SERVER-125742 (fix versions 8.0.30, 8.3.9, 9.0.0-rc1): compatibility matrix:
  - 7.0 (all): OK on every kernel.
  - 8.0.0-8.0.20: on 6.19-7.0.13, crashes after ~60s, possible corruption.
  - 8.0.21+, 8.3.x, 9.0: exit at startup on 6.19-7.0.13 (the line above). Start only on kernels
    below 6.19, or on 7.0.14+/7.1+.
  - Open SERVER-136848: the gate ignores Ubuntu's patch level, so it also blocks Ubuntu kernels
    carrying the 7.0.14 fix. GitHub `ubuntu-latest` is Ubuntu 24.04.
- Docker Hub, 2026-10-17: `mongo:7.0` = `7.0.45`; `mongo:8.3` = `8.3.13`; `mongo:9.0` = `9.0.4`.
  `mongo:8.3.13` still has the gate.
- endoflife.date: 7.0 security support ends 31 Aug 2027.

Conclusion: no 8.x or 9.x image starts on every runner kernel. Choose **`mongo:7.0.45`**. It
satisfies the suites:
- Wait pattern `(?i)waiting for connections`, occurrence 2 (`mongo.go:83`): 7.0 logs structured
  JSON like 4.4+, and its entrypoint double-boots the same way.
- Version assertion: `MongoServerMajor()` derives `"7"`, so `mongo_test.go:35` follows.
- db-compat range: min `4.4` passes today, so nothing in the suite needs above 7.0.

Trade-off for the user: CI loses MongoDB 8.x/9.x server coverage. Record it as a Known open item
(step 6). A kernel-gated skip or a max that runs only on lucky runners was rejected: that hides a
failure behind runner luck, the thing this fix removes.

## Audit: same class of instability in the other suites

1. **Floating tags plus a hash-keyed image cache: real.** PR CI caches images under
   `docker-<os>-<hash of testsupport/*.go>` (`pr.yml` go-containers, restore/save steps).
   Upstream retags (`clickhouse-server:26.3` retagged 2026-10-21, `redis:8.10` same day,
   `mongo:8.3` 2026-10-17) never change that key. `pull-test-images.sh:30` skips any tag already
   present. Result: PR CI runs a stale build while release (`test-matrix.sh --mirror`) pulls fresh.
   Same tag, different binaries per job. Fix: pin exact patch tags (step 2). Then the constant is
   the content, and the cache key changes only when a pin changes.
2. **Kafka SASL fixture has no broker-readiness poll: real.** `kafka_sasl.go:185` waits only for
   `Kafka Server started`. `docs/HISTORY.md:1285` ("log-based wait fires before the advertised
   listener serves") fixed exactly this for plain Kafka with
   `waitKafkaBrokerReady` (`kafka.go:82`, called `kafka.go:140`). `kafka/main_test.go:14`
   prewarms `kafka` and `kafkasasl` concurrently, the condition that triggered the original flake.
   Fix: step 4.
3. **Hand-copied image list in `test-matrix.sh:42-52`: real drift risk.** It must equal the
   testsupport constants by hand, and step 2 makes the tags change more often. Fix: step 3.
4. **No kernel in CI logs: real.** A kernel-dependent failure cannot be told apart from a flake in
   the job log. Fix: step 5.
5. `pickFreeHostPort` race (`kafka_sasl.go:78`): real but negligible. It runs once per test binary
   and is documented in place. No change.
6. Postgres (`postgres.go:104`, log x2), MySQL/MariaDB (module waits), ClickHouse (module wait),
   Redis (`redis.go:90`), LocalStack (`localstack.go:39`, HTTP health): not real. No flake history,
   and none of these servers uses tcmalloc's rseq path.
7. Retries masking failures: none in the test path. `fixture.get` (`fixture.go:47`) remembers a
   failed start and fails every test, never retries. `release-ci-gate.sh:36` `retry` wraps only
   `gh api` calls. `test-matrix.sh`/`db-compat.sh` run every row and exit 1 on any failure.
8. `localstack/localstack:4`: frozen at 4.14.0 since 2026-02-26 (LocalStack moved to CalVer), so
   no drift today. Pin it anyway in step 2 for one rule across all images.
9. P306 (v2.8) container fixes (`-count>1` state reset) cover reruns inside one process. They do
   not relate to this kernel failure.

## Loud and deterministic

- Determinism: `mongo:7.0.45` starts on every kernel in the pool. Exact pins remove per-job image
  drift.
- Loudness: today's failure is already loud. It fails in ~2s, prints the fatal line, and
  `fixture.go:75` fails every Mongo test. Step 5 adds the kernel to the job log so the next
  kernel-dependent failure reads as one. No retries, no skips.

## Steps

1. **Mongo pin** (`fix:` commit).
   - `apps/kira-studio/internal/adapters/testsupport/mongo.go:23`: `MongoImage = "mongo:7.0.45"`.
     Above the `const` block, add a short comment: 8.x/9.x exit at startup on kernels 6.19-7.0.13
     (SERVER-125742); do not bump to 8.x/9.x until no runner kernel is in that range.
   - `mongo.go:79`: change "verified against mongo:8.3" to "verified against mongo:7.0.45", after
     verifying it (step 7).
   - `scripts/db-compat.sh:53-54`: `MONGO_MIN="mongo:4.4.30"`, `MONGO_MAX="mongo:7.0.45"`.
   - `scripts/test-matrix.sh:48`: removed by step 3; if step 3 is not done, set `mongo:7.0.45`.
   - `testsupport/images_test.go:22`: case becomes `{"dotted patch tag", "mongo", "mongo:7.0.45", "7"}`.
2. **Exact patch pins for every image** (`fix:` commit). Digests matched on Docker Hub 2026-10-21.
   Before committing, confirm each tag still resolves to the floating tag's digest:
   `curl -s https://hub.docker.com/v2/repositories/<repo>/tags/<tag>`.
   - `postgres.go:70` `postgres:17.11-alpine`
   - `mariadb.go:21` `mariadb:11.4.13`
   - `mysql.go:22` `mysql:8.4.11`
   - `clickhouse.go:31` `clickhouse/clickhouse-server:26.3.58`
   - `redis.go:19` `redis:8.10.2`
   - `localstack.go:20` `localstack/localstack:4.14.0`
   - `kafka.go:30` already exact (`8.0.7`).
   - `db-compat.sh:44-59`: `postgres:14.24-alpine`/`postgres:18.6-alpine`,
     `mariadb:10.11.19`/`mariadb:12.3.3`, `mysql:8.0.46`/`mysql:9.7.2`,
     `clickhouse/clickhouse-server:25.3.14`/`26.8.33`, `redis:7.0.15`/`redis:8.10.2`,
     `localstack/localstack:3.8.1`/`4.14.0`. Kafka is already exact.
   - Grep conformance tests for any assertion on a minor version (`ServerVersion`, `VersionPattern`
     callers). Only majors are expected; if a test asserts a minor, fix that test.
3. **`test-matrix.sh` image list from one source** (`refactor:` commit). Drop the third column of
   `MATRIX` (`test-matrix.sh:42-52`) and its header comment. At `test-matrix.sh:74-78`, set
   `IMAGES="$(go run ./apps/kira-studio/internal/adapters/testsupport/cmd/testimages)"`. The
   script already runs from `$ROOT_DIR` (`test-matrix.sh:18`), the same source as
   `pull-test-images.sh:39`. `--only` then pulls the full set. That is fine: it is a local convenience, and
   images stay cached.
4. **Kafka SASL readiness** (`fix:` commit). In `startKafkaSasl` (`kafka_sasl.go`), after the
   `GenericContainer` error check (~:191), dial a `kgo` client with
   `kgo.SASL(plain.Auth{User: kafkaSaslUsername, Pass: kafkaSaslPassword}.AsMechanism())` to
   `daemonHost:hostPort`. Call `waitKafkaBrokerReady(ctx, client)` (`kafka.go:82`), then close the
   client. On error, close the client, `container.Terminate`, and return a wrapped error
   (`kafka sasl broker not ready: %w`).
5. **Kernel line in container-test logs** (`chore:` commit). No workflow change needed: all three
   CI entry points run a script. Print the Docker host's kernel once at the start of each:
   - `scripts/test-matrix.sh`, `scripts/db-compat.sh` (after arg parsing), and the `containers`
     branch of `scripts/go-test-split.sh`.
   - Line: `echo "<script>: docker kernel $(docker info --format '{{.KernelVersion}}' 2>/dev/null || echo unknown)"`.
     Use `docker info`, not `uname -r`: on macOS/Colima the containers run in the VM's kernel.
6. **Docs** (`docs:` commit).
   - `docs/ARCHITECTURE.md` near :2863 (test-matrix/db-compat facts): one bullet. Test images pin
     exact patch tags, because the PR CI image cache keys on `testsupport/*.go` and a floating tag
     would run different builds per job. Mongo stays on 7.0 because of SERVER-125742.
   - `docs/ARCHITECTURE.md` Known open items (:2937): add **MongoDB 8.x/9.x servers are unverified
     in CI.** Every 8.x/9.x image exits at startup on runner kernels 6.19-7.0.13 (SERVER-125742,
     SERVER-136848 for Ubuntu). Test and db-compat max pin `mongo:7.0.45`. Restore an 8.x/9.x max
     once runner kernels leave that range. 7.0 support ends 2027-08-31.
7. **Verify** (once, at the end).
   - Fast: `go vet ./apps/kira-studio/internal/adapters/...`,
     `go test -count=1 ./apps/kira-studio/internal/adapters/testsupport/`,
     `sh -n` and `shellcheck` on the three scripts, the pre-commit hook on every commit (never
     `--no-verify`).
   - Real containers: Docker is installed but the daemon is down here. Start it per
     `docs/DEV_ENVIRONMENT.md` (`setsid nohup dockerd > /tmp/dockerd.log 2>&1 < /dev/null &`), then
     run `bun run test:images`. Run:
     - `go test -count=1 ./apps/kira-studio/internal/adapters/mongo/...`
     - `sh scripts/test-matrix.sh --only mongo --mirror` and `--only kafka --mirror`
     - `sh scripts/db-compat.sh --only mongo --min --mirror` and `--max`
     - `bun run test:go:containers` once, for the new pins.
     Every Mongo test must show PASS, not SKIP.
   - Kernel 6.19 case: this sandbox runs 6.18.44, below the gate, so it cannot reproduce the exit.
     Prove it statically from the binaries:
     `docker run --rm --entrypoint grep mirror.gcr.io/library/mongo:7.0.45 -c "known incompatibility with this version of MongoDB" /usr/bin/mongod`
     must print `0`. The same command on `mongo:8.3.13` must print >=1, which proves the check
     targets the gate. Together with the SERVER-125742 matrix, this covers 7.0 on 6.19+.
     Final proof is CI: PR CI `go-containers`, then release `test-matrix`/`db-compat`. Each job log
     now names the kernel; accept only a green run whose logged kernel is >=6.19.

## Out of scope

- `packages/db-fixtures/support/*.ts` `IMAGE` constants (TS tier; not in the failing jobs).
- Container cleanup on fixture error paths (`mongo.go:93-126` returns without `Terminate`). Ryuk
  reaps it locally, and CI runners are ephemeral. No failure traced to it.
