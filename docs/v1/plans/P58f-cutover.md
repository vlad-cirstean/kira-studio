# P58f — the cutover: `src/engine` deleted, the Node sidecar gone

> **This is the last of P58's six sub-phases** (`docs/v1/plans/P58-go-native-adapters.md` §0.3). Its
> two milestones are the parent's own **M10** (the deletions) and **M11** (documentation and CI).
> Every count, path and line reference below was read out of the tree at `1834afc`
> (`docs: P58e findings — the last adapter, and checkpoint C2`, working tree clean), not carried over
> from the parent plan's own §1.12/§3, both of which were written before a single adapter had been
> ported and are stale in ways §1 below enumerates one by one.
>
> **P58f writes no new adapter and makes no new driver decision.** It is deletion, one rewrite
> (`tests/ipc/`'s fixture generator, P58 D13) and documentation. It is therefore a shorter plan than
> P58a–P58e's, deliberately: there is no probing milestone, no external-library research, and no
> acceptance-suite-per-scenario porting table to build. What it does owe, and what P58a–P58e could
> not give it, is a **verified** deletion list and a resolution for every open question those five
> sub-phases handed forward.

---

## 0. What this sub-phase is, and what it is not

### 0.1 Why now

`nativeKinds` reached ten of ten at P58e M9.3 (`shell/internal/adapterhost/router.go:22`), and
**checkpoint C2 was recorded for real in P58e M9.4** — ten kinds exercised in one live `-tags server`
session against real containers, plus a cancel, a settings save and a cache clear, with
`grep -c 'routed a connection request to the Node engine child'` returning **0** against a log that
demonstrably carried other lines from the same run. The parent's **R1** (*"nothing in M10 starts
before C2 is recorded"*) is satisfied, in writing, with a per-kind table in
`docs/v1/plans/P58e-kafka.md` §13 and in `AGENTS.md`'s P58e findings.

The Node engine child still spawns on every launch, still costs a vendored Node runtime in the
bundle, still runs an esbuild step in every build, and answers exactly **one** `ping` per page load.
Everything that was waiting on C2 is now waiting only on this sub-phase.

### 0.2 Scope

**M10 — the deletions.** `src/engine/` (110 files, 13 637 lines), `shell/internal/enginehost/`,
`shell/internal/enginetest/`, `shell/internal/enginebackend/`, `shell/main.go`'s engine block, the
vendored-Node and engine-bundle build steps and every check that asserts them, `package.json`'s ten
runtime dependencies, the routing indirection inside `adapterhost.Router`, the `tests/db/` and
`tests/ipc/` TypeScript backend halves and the two capture scripts built on them — **and** P58 D13's
fixture-generator port, which must be green before those backend specs are deleted, not after.

**M11 — documentation and CI.** `docs/ARCHITECTURE.md`, `docs/PACKAGING.md`, `docs/PERF.md`,
`AGENTS.md`'s P58f findings entry plus every section whose subject M10 removes, `docs/v1/SPEC.md`'s
P58 row, and `.github/workflows/{ci,release}.yml` — landed if the session's push scope allows,
re-staged and recorded if not.

### 0.3 Not in this sub-phase

- **No repo restructuring.** Moving `src/renderer` to the top level, folding `shell/` up, renaming
  `tests/` tiers, collapsing `src/shared` into the renderer — none of it. That is **P58g**, a
  separate future phase with its own Opus plan and its own SPEC row, and folding it into P58f would
  make a 20 000-line deletion diff unreviewable by mixing it with a 20 000-line move diff. The one
  place P58f touches the shape of the tree is where a directory becomes **empty**
  (`src/engine/`, `shell/internal/enginehost/`), which is deletion, not restructuring.
- **No code review.** P59 owns that, five rounds, per `docs/v1/SPEC.md` §10.
- **No new adapter capability and no new test tier.** The one thing P58f *adds* is the Go
  fixture generator (§4), and it exists to keep an existing tier's guarantee, not to create one.
- **No renderer feature change.** §3's **P58f D8**, **D11** and **D18** are the complete list of
  `src/` edits, and §6's acceptance criteria enumerate them by file.

---

## 1. What re-reading the tree found

Every subsection here corrects something the parent plan or a sub-phase plan asserts. This is the
section the M10 implementer should read before deleting anything.

### 1.1 `src/engine` is 110 files / 13 637 lines, not 119 / 14 847

`git grep -c "" -- src/engine` at `1834afc`. The parent's §1.1 figure predates the RabbitMQ drop
(`adapters/rabbitmq/`, 9 files / 1 209 lines) and one line lost from `registry.ts` (33 → 32). The
delta is exactly `14 847 − 1 209 − 1 = 13 637`. Nothing else in `src/engine` changed across P58a–P58e
— which is itself worth recording: **the ten adapters were ported without editing a single line of
the TypeScript they were ported from**, so every one of the 110 files is a clean delete with no
merge history to untangle.

| Directory | Lines | Files |
|---|---:|---:|
| `adapters/postgres/` | 1 726 | 10 |
| `adapters/mysql-family/` + `mariadb/` + `mysql/` | 1 782 | 22 |
| `adapters/clickhouse/` | 1 473 | 10 |
| `adapters/sqlite/` | 1 430 | 10 |
| `adapters/mongo/` | 1 382 | 10 |
| `adapters/redis/` | 1 153 | 8 |
| `adapters/kafka/` | 1 150 | 8 |
| `adapters/s3/` | 915 | 8 |
| `adapters/sqs/` | 671 | 8 |
| `adapters/` shared (7 files) | 839 | 7 |
| `cache/` | 410 | 4 |
| `control.ts`, `data.ts`, `rpc.ts`, `scheduler/ops.ts`, `stdio-main.ts` | 706 | 5 |

### 1.2 The four `tests/db/*.spec.ts` P58b was supposed to delete are still there

**Checked, and this is the answer to P58c OQ-1 / P58d OQ-1 / P58e OQ-1's factual half.** At `1834afc`:

```
tests/db/clickhouse.spec.ts   1 735 lines
tests/db/mariadb.spec.ts      1 565
tests/db/mysql.spec.ts        1 793
tests/db/sqlite.spec.ts       1 672
```

— 6 765 lines, four kinds that have been Go-native since P58b M6 (May of this migration's own
sequence), each running a full container suite against a TypeScript adapter that serves no
connection in the real app. `tests/db/` holds nothing else: `postgres.spec.ts` went in P58a,
`{mongo,redis}.spec.ts` in P58c, `{sqs,s3}.spec.ts` in P58d, `kafka.spec.ts` in P58e M9.4.
`scripts/run-db-tests.sh` is now a one-line `bun test tests/db` wrapper (P58e E19) around exactly
these four files. **P58f D1** resolves it.

### 1.3 `tests/db/` is not deletable as a directory, and the parent's §3 says it is

`tests/db/fixtures/*.sql` are read **at runtime by the Go acceptance suites**, by absolute path:

```
internal/adapters/testsupport/postgres.go:116   tests/db/fixtures/0001_seed.sql
internal/adapters/testsupport/mariadb.go:85     tests/db/fixtures/0002_mariadb_seed.sql
internal/adapters/testsupport/mysql.go:80       tests/db/fixtures/0008_mysql_seed.sql
internal/adapters/testsupport/sqlite.go:55      tests/db/fixtures/0009_sqlite_seed.sql
internal/adapters/testsupport/clickhouse.go:87  tests/db/fixtures/0010_clickhouse_seed.sql
```

That is **P58 D12 working exactly as designed** (*"port to Go seeders reading the same `.sql` files,
unchanged, so the dataset a Go adapter is judged against is byte-identical"*), and it means five
`.sql` files and the directory that holds them survive P58 permanently. The parent's §3 target-tree
row `tests/db/ DELETED` is wrong as written; only `*.spec.ts` was ever meant.

Separately, **five `tests/db/support/*.ts` modules survive** because `tests/e2e-real/support/*.ts`
re-exports them (`docker.ts`, `postgres.ts`, `mariadb.ts`, `sqlite.ts`, `kafka.ts`), plus
`fixtures/0005_kafka_seed.ts`, which `support/kafka.ts` reads. §5's deletion list resolves each one
by consumer count rather than by directory.

### 1.4 `tests/ipc/` is six adapters, not seven

`clickhouse`, `kafka`, `mariadb`, `mysql`, `redis`, `sqs`. The parent's §1.11/§5.1/D13 all say
"seven" — RabbitMQ's folder went with the kind. 6 × 3 files plus `clickhouse/container.ts` plus five
`support/` modules; 1 797 lines of backend specs, 3 246 lines of committed fixtures, 837 lines of
frontend specs.

### 1.5 The committed `tests/ipc/` fixtures **cannot** be reproduced byte-for-byte by a Go generator, and one frontend spec's assertion is already false

This is the single most consequential finding for M10, and it invalidates the parent's §8 criterion 5
(*"`git diff --stat tests/ipc` shows no change to any `*.fixture.ts` or any `*.frontend.spec.ts`"*).

`tests/ipc/kafka/kafka.fixture.ts:151` carries, verbatim:

```
'Topic configuration is not available: this Kafka client has no DescribeConfigs call.'
```

That string is a **capability loss the Go adapter recovered** (P58e E11 / P58 D7: `kadm`'s
`DescribeTopicConfigs` returns 32 real config rows for the seeded `orders` topic — measured in P58e
M9.0's KF-4(b)). And `tests/ipc/kafka/kafka.frontend.spec.ts:127` asserts:

```ts
await expect(configSection.locator('.def-row')).toHaveCount(0);
```

— an assertion that is **already wrong about the shipping app** and only still passes because the
fixture it mocks was captured from the deleted TypeScript adapter. The same file's line 195 freezes
`"type": "CLASSIC"` and `"partitionAssignor": ""` in the consumer-group definition — the exact two
rows P58e E13 dropped and merged.

So the fixture regeneration is not a formality; it is the moment this tier stops describing a dead
adapter. **P58f D13** amends the criterion rather than pretending the diff can be empty.

### 1.6 `tests/ui/`'s stream mock still speaks the index-keyed encoding, so P58 D5's decoder branch cannot be deleted alone

`tests/ui/support/mockStreamBrowser.js:62-85` builds real `Uint8Array`/`Uint32Array` chunks and
`:243` delivers them with `JSON.stringify(frame)` — i.e. the `{"0":1,"1":2,…}` shape. That is the
**only** encoding either mocked tier exercises today, for `tests/ui/`'s 36 tests *and* for
`tests/ipc/**/*.frontend.spec.ts`, which drive the same fixture through `tests/ui/fixtures.ts`.

The parent's §5.1 predicted this change and assigned it to **M2** (*"needs its chunk fields emitted
as base64 rather than index-keyed objects, which is a fixture-generator change, not a spec
change"*). It did not happen in M2 — correctly, because P58a A9's dual decoder meant it did not
have to. It is now P58f's, and it is the one thing that must land in the same commit as
`port.ts`'s `toTypedArray` losing its `Object.values` fallback (`src/renderer/bridge/port.ts:91`).

Also worth carrying forward: `mockStreamBrowser.js` computes **real** `byteSize` values via
`page.ts`'s own formula (`:96-110`), fixed in P57 after the `byteSize: 0` incident. Changing the
encoding must not touch that.

### 1.7 The status bar's cache readout has been reporting the wrong number since P58a M5, and M10 is where it either gets fixed or goes silent

`src/renderer/state/cacheStats.ts` sets `cacheStatsState.stats` **only** from the unsolicited
`PORT_EVENT.cacheStats` push (`data.onCacheStats`). Nothing in the renderer ever issues the
`DATA_OP.cacheStats` *request* — `shell/internal/adapterhost/dataframe.go`'s own comment says so
(*"rare — nothing in the renderer actually issues one today"*).

The push has exactly one producer: the Node child's `src/engine/cache/index.ts` throttled emitter,
relayed unchanged by `Session.Send` → `Router.observeChildEvent` (which only *snapshots* it) →
`enqueue`. `enginecache.Cache.OnStatsChanged` exists (`internal/enginecache/cache.go:194`) and has
**zero production consumers** — grepped.

So today: `Router.PushCacheConfig` calls `enginehost.PushCacheConfig` at startup, the child's
`cache.configure()` schedules one emit, and the renderer receives one `cache:stats` frame reporting
`l2Bytes: 0, l2Entries: 0, l2Hits: 0, l2Misses: 0` from a cache that will never serve anything. Every
page the app actually caches lives in Go's `enginecache`, unreported. `Router.mergedCacheStats()`
(A16) does sum both — but only on the pull path nobody uses.

This is precisely the failure the parent's own §4.6 named (*"a status bar that under-reports cache
size for five sub-phases… exactly the kind of silently-wrong number `AGENTS.md`'s P57 findings warn
about"*) and its mitigation covered the wrong half. **P58f D12** fixes it, and it must be fixed
rather than merely inherited, because after M10 there is no producer at all and the readout would
stay `null` forever.

### 1.8 The Go side's dependency on `enginehost` is wider than "the engine child", and three of the four consumers are not about the child at all

`grep -rn "enginehost" --include=*.go` outside the package itself returns **28 live references
across 11 files**. Categorised, because M10's shape depends on the split:

| Consumer | What it actually uses | Fate |
|---|---|---|
| `internal/adapterhost/host.go` | `enginehost.Event`, `EventOpStart`, `EventOpEnd` — the op-log event *type*, not the child | **Type relocates** (P58f D9) |
| `internal/adapterhost/session.go` | `enginehost.ErrStreamFull` — the backpressure sentinel | **Constant relocates** into `adapterhost` |
| `internal/oplog/wire.go` + `wire_test.go` | `Event`, the three topics, `EventEngineDown` | **Type relocates**; `EventEngineDown` loses its publisher (P58f D9) |
| `internal/enginebackend/` (2 files, 131 lines) | fans two `oplog.EventSource`s into one | **Whole package deletes** — one producer left |
| `internal/adapterhost/router.go` | `child`, seven `*ViaChild` methods, `OpConnect`…`OpCancel`, `PushCacheConfig`, C2's counter | **Deletes** (≈ 190 of `router.go`'s 462 lines) |
| `internal/connections/service.go` | `Deps.Host`, `watch()`, `EventEngineDown` → `MarkAllErrored` | **Deletes** (P58f D10) |
| `internal/appcore/deps.go` | `EngineHost`, `NodeVersion` fields | **Fields delete** |
| `internal/bridge/engine.go` | `Deps.EngineHost.Alive()/PID()` | **Rewritten** (P58f D11) |
| `internal/bridge/app.go:34` | `Deps.NodeVersion` | **Field deletes** (P58 D14) |
| `shell/main.go` | `resolveEngine`, `nodeVersion`, `firstExisting`, `enginehost.Start`, `enginebackend.Merge` | **Deletes** |
| `internal/{connections,tree}/…_test.go`, `internal/adapterhost/integration_test.go` | `enginetest.Host(t)` + `NewRouterAllNodeServed` | **Rewritten / deleted** (§5.4) |

The parent's §1.12 lists only `enginehost/`, `enginetest/`, `main.go`'s block and `ops.go`'s op-name
constants. It misses `enginebackend` (which did not exist when it was written), the `Event` type
relocation, `ErrStreamFull`, and the three Go test files that drive a real Node subprocess.

### 1.9 `EngineService.Status()` has zero renderer callers, and the status pill reads the data plane

**P58 D14's premise is wrong about which surface matters.** `tests/ui/support/bootSnapshots.ts:21`
states it outright: *"`engineStatus` is deliberately absent — nothing in the renderer ever calls it
(the status pill reads the data-plane ping instead)."* Confirmed:
`src/renderer/workbench/state/engine.ts` calls `request('ping')` on the port and reads
`PingPayload.enginePid`; `src/renderer/bridge/control.ts:108`'s `engineStatus` binding is dead code
with no caller. `dataframe.go:61-63` forwards `ping` to the child unconditionally (P58a A17), and the
child's `src/engine/rpc.ts:16-19` answers `{pong: true, enginePid: process.pid, at: Date.now()}`.

So after M10 the pill goes `down` on every launch unless the `ping` is answered in-process.
**P58f D11** answers it locally and keeps `EngineService.Status()` bound (deleting a bound service
means regenerating bindings *and* editing `control.ts`, which buys nothing).

### 1.10 `tests/e2e-real/mariadb-real.spec.ts`'s second test dies with the child

P58e E21 rewrote it, three weeks ago, into checkpoint C2's automated half: it `pgrep -P
<serverPid>`s the Node child, `SIGKILL`s it, asserts both connections keep serving reads, and
asserts `engine-status` flips to `down` after `port.ts`'s 30 s `DEFAULT_TIMEOUT_MS`. After M10 there
is no child to `pgrep` (`childPids.length` would be 0 and the test fails at
`expect(childPids.length).toBeGreaterThan(0)`), and the pill never goes `down`.

The parent's §3 row (`tests/e2e-real/ EDITED — no vendored-node prerequisite; more engines
reachable`) does not anticipate this. **P58f D3** decides it.

### 1.11 Two dev capture scripts and one unit spec die with `src/engine`, and none of the three is in any plan's list

- `scripts/capture-tree.ts` (231 lines) and `scripts/capture-postgres-tree.ts` (248 lines) both
  `import { openHarness } from '../tests/ipc/support/harness'`, which dynamically imports
  `src/engine/control.ts` and `src/engine/rpc.ts`. They are the *"capture, don't hand-write"* tools
  `AGENTS.md`'s Docker section names by path for building a `tests/ui/` fixture from a real shape
  (P50 D5). Their subject is gone at M10.
- `tests/unit/catalog-listing.spec.ts` (145 lines, 9 tests) imports
  `src/engine/adapters/{redis/catalog,s3/catalog}` and is the **only** coverage anywhere of the
  two-term truncation conjunction (a round cap hit **and** the server says there is more). Checked
  against the Go side: `internal/adapters/redis/catalog.go:193` and
  `internal/adapters/s3/catalog.go:120` both carry the conjunction, and the only Go assertion is
  `s3_test.go:172`'s *negative* case (`Truncated == nil` for an ordinary listing). The positive
  branch has no Go coverage. This is exactly the class `AGENTS.md`'s testing bar keeps
  (*"a decision structure… interacting rules"*), and its own header explains why a live assertion is
  impractical (*"a namespace/prefix big enough to survive `MAX_SCAN_ROUNDS`… without seeding 200 000
  keys"*). **P58f D14**.

The parent's §3 lists `tests/unit/{engine-cache,sql-text}.spec.ts` for deletion; both are **already
gone** (deleted in P58a M3 and M1 respectively, checked). `catalog-listing.spec.ts` is the one it
missed.

### 1.12 The build-and-package surface is five files, not the two the parent names

Beyond `scripts/{vendor-node,run-db-tests,run-ipc-backend}.sh` and `package.json`:

- **`shell/build/darwin/Taskfile.yml:170-180`** hard-fails `create:app:bundle` unless
  `runtime/node/bin/node` and `runtime/engine/engine.cjs` both exist, then `cp -R runtime` into
  `Contents/MacOS/`. **No plan document has ever listed this file.** Leaving it is not cosmetic:
  after M10 the package task would abort on every build.
- **`biome.json:104` and `:124`** carry two `overrides` blocks scoped to `src/engine/adapters/**`
  and `src/engine/adapters/s3/**` (the "an adapter imports nothing from `electron`" and the
  "`transfer.ts` is the only file that touches `node:fs`" rules). Both become overrides matching
  nothing. Also unlisted anywhere.
- **`scripts/verify-packaging.sh`**'s A1 loop, A2 block, A4 block and N1 block, and
  **`scripts/sign-bundle.sh`**'s `NODE_BIN` hard-fail and `KAFKA_NATIVE` block. P58e M9.4 corrected
  their *message strings* and explicitly deferred deletion to P58f (**P58e E22** / its OQ-4).
- **`scripts/wails-dev-setup.sh:67-75`**, whose two prerequisite checks are the most common
  "why won't the app start" failure a fresh session hits.

### 1.13 `docs/ARCHITECTURE.md` contradicts itself in two places already, and three driver facts in it are wrong today

Not a P58f-created problem, but M11 owns it and the list should be explicit rather than "update per
§3":

1. **The Invariants section (`:71-77`) still carries the pre-P58 bulk-data invariant**
   (*"Bulk data passes through the Go process without being parsed… Go never unmarshals a data-plane
   frame"*), while the Process model section (`:614-628`) carries **P58 D3's replacement**
   (*"The data plane is a server now, not a byte forwarder"*). The two are directly contradictory and
   have been since P58a M4. D3 required the rewrite *"in the same commit as the code"*; only the
   Process-model half landed.
2. **`:45` names `mattn/go-sqlite3` as the sqlite driver.** `shell/go.mod` has no such module. Both
   the sqlite adapter and app storage run on `modernc.org/sqlite` (P58b B7 for the adapter, commit
   `50a1a2f` for storage). **The whole product binary is cgo-free for its own code now** — a
   materially better outcome than P58 D8 predicted and one nothing has claimed yet.
3. **`:620` says `nativeKinds` is `{"postgres": true}` as of P58a M5, every other kind still
   Node-served.** It is ten of ten.
4. **The Adapter contract section (`:82-92`) describes `src/engine/adapters/` only**, including
   *"`registry.ts` lazily `import()`s each adapter directory so an unused engine's driver is never
   loaded into the engine process's baseline memory"* — a statement about a process that will not
   exist. This is P58a's OQ-6, unresolved through five sub-phases.
5. **The Process-model "Known regression" paragraph (`:684-696`)** describes the JSON-inflation
   hop as *"not fixed"* and names P58 as the future phase that would fix it. It is fixed and
   measured (`docs/PERF.md` §2.5: 1.334× vs 10.872× wire, 6.86× vs 40.9× transient heap).
6. **The Testing section (`:786-790`)** says `tests/db/` is *"entirely untouched by the shell
   migration: the adapters did not move"* and (`:836`) that `tests/e2e-real/` is *"two specs
   (sqlite, postgres)"*. Both false; there are three specs and four `tests/db` files left.
7. **The Stack table** still describes the engine build (esbuild), the engine runtime (vendored
   Node), Zod guarding `src/engine/{control,rpc,data,stdio-main}.ts`, and *"the engine child keeps
   writing to stdout/stderr, which the shell pipes into the same sink"*.

`AGENTS.md` carries the matching cgo error twice (`:205`, `:238`).

### 1.14 The CI workflows are two generations stale

`.github/workflows/{ci,release}.yml` at `1834afc` are still **Electron-era**: `safeStorage`,
`bun run test:e2e`, `package:mac:dir`, `dist/mac-arm64/…/app.asar.unpacked/out/main/engine.js`. The
P57 revision sits unmerged in `docs/v1/plans/p57-pending-ci-workflows/` (its `README.md` explains the
`workflow` OAuth-scope gap), and **that staged revision is itself now stale for P58**: it runs
`sh scripts/vendor-node.sh`, `bun run build:engine`, and asserts
`test -f "$APP/Contents/MacOS/runtime/engine/engine.cjs"` / `test -x "…/runtime/node/bin/node"`.
Neither file contains `test:db` or `test:ipc:be`, so those two disappearing costs nothing.

### 1.15 `advanced.engineMemoryCapMb` is reachable from the settings dialog and has no successor

`src/renderer/workbench/SettingsDialog.vue:302-309` renders an "Engine memory cap (MB)" control;
`main.go:112` turns it into `--max-old-space-size=<n>` on the child. After M10 it controls nothing.
The parent's §7 item 3 says it *"should be removed rather than left in the settings dialog doing
nothing"* — while the same document's §7 opening says the entire `src/` diff is `port.ts`. A direct
self-contradiction; **P58f D18** resolves it. Checked: **no test anywhere references the setting**
(`grep -rn engineMemoryCapMb tests/` and `--include=*_test.go` both return nothing), so the removal
is mechanical.

---

## 2. Carried-forward open questions, and where each lands

Before the decisions, the ledger — every OQ raised by P58a–P58e, with its disposition. "Closed"
means no further action; "**P58f**" means §3 resolves it; "past P58" means it survives this phase
deliberately.

| OQ | Subject | Disposition |
|---|---|---|
| P58a OQ-1 | `E_INTERNAL` outside the closed code set | **Closed** — P58a interim (c) shipped (`adapterhost/host.go:172`), the parent's D16 was amended in place. **P58f D0** ratifies it permanently |
| P58a OQ-2 | the ninth `Host.Call` site (the stop button) routes on op ownership, not kind | **Closed** — the parent's §1.5 carries the correction; M10 deletes the fallback branch entirely (§5.2), which is the only way it can ever be "simplified" wrongly |
| P58a OQ-3 | `reviveChunks`' dual decoder is a narrowing, deleted in P58f | **P58f D8** |
| P58a OQ-4 | what replaces `EventEngineDown` once there is no child; whether oplog keeps the event shape | **P58f D9** |
| P58a OQ-5 | KF-1 inside P58a's M0 | **Closed** — accepted and run |
| P58a OQ-6 | `docs/ARCHITECTURE.md`'s Adapter contract describes one adapter layer, there are two | **P58f D17** (M11) — and there is now one again, which is what makes it answerable |
| P58b OQ-1 | `mattn/go-sqlite3` cannot express the sqlite value codec | **Closed by implementation** — `modernc.org/sqlite` shipped for the adapter *and* for app storage. **P58 D6/D8's first part is superseded**; M11 records it (§1.13 item 2) |
| P58b OQ-2 | `clickhouse-go/v2`'s HTTP transport pins `default_format=Native` | **Closed by implementation** — a raw `net/http` client shipped (B11). **P58 D6's ClickHouse row is superseded**; M11 records it |
| P58b OQ-3 | `tests/ipc/` fixtures describe a producer the app stopped using | **P58f D13** — this is the sub-phase that ends it, exactly as P58b predicted |
| P58b OQ-4 | MySQL's `allowPublicKeyRetrieval` has no Go equivalent — a security-posture loss | **Closed by implementation**; **P58f D17** adds it to the parent's §7 "what gets worse" list in M11, which P58b asked for and no sub-phase did |
| P58b OQ-5 | checkpoint C1b's numbering | **Closed** — ran, recorded |
| P58c OQ-1 | the four outstanding `tests/db` deletions | **P58f D1** |
| P58c OQ-2 | the ARCHITECTURE mapping table's SQLite Cancel cell | **Closed** — fixed in P58d, mechanically, via a grep-shaped criterion |
| P58c OQ-3 | where `mariadb-real.spec.ts`'s coexistence pairing stops; whether to rename the file | **P58f D3** |
| P58c OQ-4 | Mongo's `$numberDouble` rendering gain has no slot in the parent's §7 lists | **P58f D17** (M11) — added to "what gets better" |
| P58c OQ-5 | a placeholder parked on the next kind's kind is inherited debt | **Closed** — the rule was written down and P58e paid the bill; M11 carries the lesson into `AGENTS.md` |
| P58d OQ-1 | as P58c OQ-1 | **P58f D1** |
| P58d OQ-2 | the ARCHITECTURE table edit required twice, made never | **Closed** — fixed in P58d; the grep-criterion form is adopted here too (§6) |
| P58d OQ-3 | P58c's "only `Truncated` producer" claim was wrong | **Closed** — recorded |
| P58d OQ-4 | no `E_AUTH` oracle for SQS/S3 | **P58f D7** — stays open past P58, explicitly |
| P58d OQ-5 | the parent's §5.5 S3-download `tests/e2e-real` spec cannot be built (no server-mode file dialogs) | **P58f D17** — M11 amends §5.5 so nobody re-proposes it; the coverage stays in §6's manual macOS row |
| P58e OQ-1 | as P58c/d OQ-1, now the *only* thing left in `tests/db/` | **P58f D1** |
| P58e OQ-2 | checkpoint C2's definition needed amending; the instrument was relocated | **P58f D2** |
| P58e OQ-3 | `mariadb-real.spec.ts`'s coexistence half necessarily retires | **P58f D3** |
| P58e OQ-4 | who owns the packaging scripts' Kafka blocks | **P58f D4** |
| P58e OQ-5 | the group definition's dropped `type` row | **P58f D5** — stays dropped, closed |
| P58e OQ-6 | `preview()` renders a `producer.produce(...)` call that will not exist | **P58f D6** |
| P58e OQ-7 | Kafka's untested `E_AUTH` branch | **P58f D7** — with SQS and S3 |
| P58e OQ-8 | a probe's harness is a result too | **Closed** — a process note, adopted |
| P58e OQ-9 | a build shipped between M9.4 and M10 advertises a healthy engine that answers one ping | **Closed by P58f itself** — the window ends here. If a release is cut before M10 lands, the honest minimum is still a tooltip change, and P58f does not need it |

---

## 3. Decisions

**P58f D0 — `E_INTERNAL` stays outside `AdapterErrorCode`'s closed set, permanently.** P58a OQ-1's
interim (c) has shipped and run for five sub-phases without a renderer problem:
`adapterhost/host.go:172` emits the literal string, `viewOp.ts`'s `classify` treats any unrecognised
code as `kind: 'error'`, which is the correct behaviour for a fault the closed set was never meant to
name. M11 removes the "pending this answer" note from `errors.go`'s comment and records the closure.
Nothing else changes.

---

**P58f D1 — the four remaining `tests/db/*.spec.ts` are deleted in M10, as one commit; `fixtures/*.sql`, five `support/*.ts` modules and one `.ts` seed fixture stay, because Go and `tests/e2e-real/` read them.**

This closes P58c OQ-1 / P58d OQ-1 / P58e OQ-1 by taking **disposition (c)** — *"amend P58 D12's third
rule; every remaining `tests/db/*.spec.ts` retires in P58f alongside `src/engine/`"* — the option
each of those three plans put to this author and none took.

*Why (c) and not (a) retroactively.* (a) was the right rule at P58b and it was not followed; three
sub-phases later, arguing about which sub-phase *should* have deleted them is archaeology. What
matters is the argument for (c) that P58c OQ-1 said *"nobody has made in writing yet"*: **a
still-passing TypeScript spec is a live oracle to diff a Go port against**, and P58b §11, P58c §11
and P58d §11 each explicitly recommended using it. That argument is real, it was used, and it
**expires exactly at M10**, because `src/engine/adapters/` is what the specs import. So the honest
statement is not "P58b was late"; it is "these four files kept doing a job until the day the job
ended, and that day is M10." Record it that way, and amend D12's third rule in M11 rather than
leaving a rule the phase visibly did not follow.

*What goes with them, derived by consumer count rather than by directory.* Re-grepped at `1834afc`;
the M10 implementer must re-grep, per P58a's own finding that *"a plan's 'its only consumer' claim
about a shared support file is a snapshot, not a standing fact."*

| File | Consumers after M10 | Fate |
|---|---|---|
| `tests/db/{clickhouse,mariadb,mysql,sqlite}.spec.ts` | — | **delete** (6 765 lines) |
| `tests/db/tsconfig.json` | `typecheck:db` | **delete** with the script |
| `tests/db/support/page.ts` | the four specs only | **delete** (58) |
| `tests/db/support/clickhouse.ts` | the spec + `tests/ipc/clickhouse/container.ts` | **delete** (165) |
| `tests/db/support/mysql.ts` | the spec + `tests/ipc/mysql/*.backend` | **delete** (208) |
| `tests/db/support/sqs.ts` | `tests/ipc/sqs/*.backend` | **delete** (84) |
| `tests/db/support/mongo.ts` | `scripts/capture-tree.ts` (dies, D15) | **delete** |
| `tests/db/support/redis.ts` | `tests/ipc/redis/*.backend` + `capture-tree.ts` | **delete** |
| `tests/db/fixtures/{0003_mongo,0004_redis,0006_sqs}_seed.ts` | the three support modules above | **delete** (170) |
| `tests/db/support/{docker,postgres,mariadb,sqlite,kafka}.ts` | `tests/e2e-real/support/*.ts` | **keep** |
| `tests/db/fixtures/0005_kafka_seed.ts` | `support/kafka.ts` | **keep** (see D3) |
| `tests/db/fixtures/*.sql` (5 files) | `shell/internal/adapters/testsupport/*.go`, by absolute path | **keep — permanently** |

*Named alternative, rejected:* moving the surviving `support/` modules and `fixtures/` out of
`tests/db/` into `tests/e2e-real/support/` so the directory can go. That is a **repo-restructuring
change**, it breaks five Go `filepath.Join(repoRoot(), "tests", "db", "fixtures", …)` call sites for
no functional gain, and it belongs to P58g (§0.3). M11 instead rewrites `tests/db/`'s own role in
`docs/ARCHITECTURE.md`'s Testing section: it is no longer a suite, it is **the shared fixture corpus
two other tiers read**.

---

**P58f D2 — checkpoint C2's amended definition is ratified as the phase's permanent record, and its instrument is deleted in M10.**

P58e OQ-2 asked whether the parent's literal *"leave `enginehost`'s own request counter at zero"*
should stand. It cannot: there is no such counter, `enginehost` is a transport layer that cannot
distinguish adapter traffic from lifecycle traffic, and three kind-agnostic paths (`ping`,
`cache:configure`, `cache:clear`) survive a perfectly migrated app by design. **P58e's interim is
accepted as final**: the instrument belongs in `adapterhost.Router`, counts only connection-scoped
requests, and emits a `slog.Warn` naming the kind and op rather than only incrementing.

Two consequences, both M10's:

1. `Router.noteChildRoute`, `Router.ChildRoutes`, the `childRoutes atomic.Int64` field and all eight
   call sites **delete with the child**, exactly as `router.go`'s own comment says they should
   (*"~10 lines total, deleted by P58f along with the child"*).
2. M11 records the amended definition **in the parent plan itself**, as an amendment note beside
   §0.3's C2 text — not only in P58e's §7. The parent is the document a future reader opens first;
   leaving a checkpoint definition there that names an instrument that never existed is the same
   class of stale-doc failure this sub-phase is cleaning up.

The literal alternative — making the three paths not reach the child — is now moot: after M10 they
cannot reach anything, because there is nothing to reach. It never needed its own piece of work.

---

**P58f D3 — `tests/e2e-real/mariadb-real.spec.ts`'s second test is rewritten a second time, not deleted; the file is not renamed.**

The kill-the-child half (`pgrep -P <serverPid>`, `process.kill(…, 'SIGKILL')`, the `engine-status`
→ `down` assertion and its 120 s timeout) has no subject after M10. What is left when it goes is
still worth a test, and it is not something any other tier covers:

> **two connections of different kinds, both Go-native, live in one session; both survive a
> `page.reload()`; both serve a real read afterwards** — MariaDB a `TabularPage` from `regions`, Kafka
> a `StreamPage` from `topic:orders`.

That is the only `tests/e2e-real/` coverage of a `StreamPage`, of the Kafka adapter, and of two kinds
coexisting in one app at all. Deleting it to avoid rewriting it would trade a real full-stack
assertion for a smaller diff.

Concretely, M10's edit: drop the `execFileSync('pgrep', …)` block, the `process.kill` loop, the
2 s settle wait, the two `engine-status` assertions and `test.setTimeout(120_000)` (which existed
only for `port.ts`'s 30 s ping timeout); keep the connection setup, the reload, and both post-reload
reads. Rename the test from `'C2: every connection survives killing the Node engine child…'` to
something that describes what it now proves, and rewrite the file header's three-paragraph
coexistence/C2 narrative into one paragraph of history plus one of present tense.

*The Kafka fixture stays*, which is why `tests/db/support/kafka.ts`, `fixtures/0005_kafka_seed.ts`
and the `@testcontainers/kafka` devDependency survive D1's sweep.

**No rename of the file** (P58c OQ-3's second half). `mariadb-real.spec.ts`'s *first* test is
genuinely and only MariaDB's; the second is a two-kind test in a MariaDB-named file, which is mildly
imprecise and costs nothing. A rename costs `git log --follow` legibility on a file that has now
been rewritten twice and would be renamed in P58g anyway if the tier moves. Answered, closed.

---

**P58f D4 — the packaging scripts' Node and Kafka blocks are deleted, not weakened, and `shell/build/darwin/Taskfile.yml` goes with them in the same commit.**

P58e OQ-4 asked who owns these. The answer is the parent's own **D15**: *"the vendored Node runtime,
`build:engine`, the two shell test scripts and the Kafka native-module packaging gap all retire in
the same milestone… Splitting them across milestones would leave `verify-packaging.sh` asserting a
`runtime/node/bin/node` that a passing build no longer produces."* P58e's string corrections were the
right interim (a packaging run must not print a false warning about a shipped build for however long
P58f takes) and they are now superseded rather than built on.

The exact edits, by file:

| File | Change |
|---|---|
| `scripts/verify-packaging.sh` | A1's loop reduces to `for target in "$APP"` (one target, no nested binary). **A2 is deleted outright, not weakened** — its whole subject is `resolveEngine()`'s two paths. **A4 is deleted** (`KAFKA_NATIVE`). **N1 is deleted** (`vendor-node.sh`'s trim guarantee). A3 and N2 are untouched. Renumbering is deliberately *not* done — the identifiers are referenced by `docs/PACKAGING.md` §3/§4 and renumbering would churn both |
| `scripts/sign-bundle.sh` | the `NODE_BIN` existence hard-fail and its `codesign` line delete; the `KAFKA_NATIVE` block deletes; the file reduces to one deep `codesign` over the bundle plus the `--verify` |
| `shell/build/darwin/Taskfile.yml:170-180` | the `runtime/{node,engine}` existence guard and the `cp -R runtime` step delete. **§1.12: no plan document has ever named this file, and leaving it aborts every package build** |
| `scripts/wails-dev-setup.sh:67-75` | the two prerequisite checks delete; the file's header comment loses `resolveEngine()` |
| `scripts/vendor-node.sh` | deleted (81 lines) |
| `docs/PACKAGING.md` | M11 — §1's build steps, §2's `create:app:bundle` row, §2's `vendor-node.sh`/`build:engine` paragraphs, §3's two result rows, §4 items 2/4/8, §5, and **§6's "Resolved (P58e M9)" gap bullet, which is now not merely resolved but has no subject** |

---

**P58f D5 — the Kafka consumer-group definition's dropped `type` row stays dropped, and this closes it.**

P58e OQ-5 offered to reach past `kadm` with ~15 lines of raw `kgo.Client.Request` against a generated
`kmsg.ListGroupsRequest` v5+ struct to recover the CLASSIC-vs-KIP-848 distinction. Declined, for
P58f's scope and permanently as far as this phase is concerned:

- It is **new adapter behaviour**, which §0.3 excludes and which the parent's §0.2 already forbids
  (*"No new adapter capability"*).
- It trades a raw protocol-struct dependency — the one place franz-go's API surface is least stable
  across versions — for one display row in a definition tab.
- The net capability change for Kafka is still strongly positive: two recoveries
  (`DescribeConfigs` → a real Configuration section; cluster id → `ConnectInfo.details.cluster`)
  against one lost row and one merge.

M11 records it in `docs/ARCHITECTURE.md`'s Kafka section as a named, accepted regression — which
P58e already did — and adds nothing further. If someone wants it later it is its own piece of work,
as P58e said.

---

**P58f D6 — `preview()`'s `producer.produce(...)` text is re-rendered in M10, because nothing freezes it and after M10 it is the last reference in the repo to an API that does not exist.**

P58e OQ-6 asked whether P58f should re-render it. Checked, and the constraint P58e worried about is
not there:

- `grep -rn "producer.produce" tests/` returns **nothing**. No `tests/ipc/**/*.fixture.ts` captures a
  Kafka `preview` snapshot at all, and no `tests/ui/` fixture carries the string.
- `shell/internal/adapters/kafka/kafka_test.go` asserts only that `Preview` returns `E_UNSUPPORTED`
  for a non-produce plan; it never asserts the rendered text.

So the change is free of fixture coupling, and the argument for it is strong: after M10, `node-rdkafka`'s
`producer.produce('<topic>', null, Buffer.from(...), '<key>')` names a call signature that appears
nowhere in the repository, in a **user-visible command-preview string** whose whole job (P5 D6) is to
show the user what the app is about to do. That is not archaeology in a comment; it is a lie in the UI.

New text: `ProduceSync <topic> key=<key>` (and `key=<none>` when the key is null), matching the
`kgo.ProduceSync` call the adapter actually makes. It lands in `produce.go`'s `previewProduce`
together with the deletion of its own OQ-6 comment, and M11 notes the change in
`docs/ARCHITECTURE.md`'s Kafka section beside the two recovered capabilities.

*Why M10 and not M11:* it is a code change, and M11 is documentation. Its own commit (§6), so the
one behavioural change in an otherwise-pure-deletion milestone is not buried in a deletion diff.

---

**P58f D7 — the untested `E_AUTH` branches in sqs, s3 and kafka stay untested, and P58 closes with that gap recorded rather than papered over.**

P58d OQ-4 and P58e OQ-7 both took the same interim (port the mapping on the strength of the SDK's /
`kerr`'s own named codes, record the gap, add no test) and both asked whether the parent's author
wants it closed. **No — and not in P58f.** Closing it means a second LocalStack container customizer
with `ENFORCE_IAM=1` whose fidelity to real AWS is itself unproven, plus a SASL/PLAIN-configured
`cp-kafka` variant. That is new test infrastructure for three adapters in a sub-phase whose job is
deletion, and it would close the gap for one adapter at a time at real per-container cost.

M11's `AGENTS.md` entry carries it forward as **named, deliberate, post-P58 work**, in the same
sentence for all three adapters, so a future session finds one item rather than three scattered
sub-phase OQs. It is a good candidate for P59's functional-correctness round to re-price.

---

**P58f D8 — `port.ts`'s index-keyed decode branch and `mockStreamBrowser.js`'s index-keyed encoding are deleted in the same commit, and no other commit may touch either file.**

This closes P58a OQ-3's forward half. Two edits, one commit, because either alone is a red tree:

1. `src/renderer/bridge/port.ts:77-92` — `toTypedArray` loses `return ctor.from(Object.values(v as Record<string, number>))` and its `typeof v === 'string'` guard, becoming an unconditional base64 decode. Its comment loses the "the ten still-Node-served kinds" clause.
2. `tests/ui/support/mockStreamBrowser.js:62-85` — `encodeChunk` returns base64 strings rather than typed arrays, so `JSON.stringify(frame)` at `:243` puts the same shape on the wire that `page.Chunk`'s `MarshalJSON` does.

Three constraints on (2), each of which has already cost this repo a real bug:

- **`chunkByteSize` (`:95-102`) must keep reading real byte lengths, not base64 string lengths.** It
  mirrors `src/shared/protocol/page.ts`'s formula exactly, and P57's `byteSize: 0` incident
  (`AGENTS.md`) is what happens when it stops. Compute the sizes from the typed arrays *before*
  encoding and carry them, rather than deriving them from the encoded strings.
- **`Uint32Array` must be encoded as base64 of its little-endian bytes, not of its decimal digits.**
  That is `page.Uint32LE.MarshalJSON`'s contract (`internal/page/chunk.go:38`), and the browser side
  needs `new Uint8Array(u32.buffer)` — which is little-endian on every platform this app targets, but
  the file should say so rather than rely on it silently.
- **The base64 encoder runs in the page, not in Node.** `mockStreamBrowser.js` is injected as a
  string via `page.addInitScript` and is plain uncompiled ES5-ish JS (`mockStream.ts`'s own doc
  comment explains why). `btoa` over a binary string built with `String.fromCharCode` is the
  available primitive; `Buffer` is not.

`bun run test:ui` (36 tests) and `bun run test:ipc:fe` (6 specs) are the gate on this commit, and
both exercise the new branch on every page they render — which is the point: after this commit the
mocked tiers speak the same encoding the real app does, which they have not since P58a M5.

---

**P58f D9 — the op-log event shape survives M10; `enginehost.Event` and its three topics relocate to `internal/oplog`; `internal/enginebackend` is deleted; `EventEngineDown`'s successor is a sweep when the event channel closes.**

This resolves P58a OQ-4, whose forward half was explicitly left to P58f (*"Whether P58f keeps the
event shape or converts oplog to typed direct calls is a P58f design decision that should be recorded
as such rather than assumed either way"*).

*Keep the event shape.* The tempting move is D10's original letter — `op:start`/`op:end` become
direct typed calls into `internal/oplog` — which would delete a `json.Marshal`/`Unmarshal` round trip
per op-log row (A14's own named cost). Rejected, for one concrete reason: `oplog/wire.go:89-90`'s
comment is load-bearing —

> *"consume is the only reader and writer of `inFlight`, so that map needs no mutex — nobody should
> add one."*

Adapter ops run on their own goroutines (one per data frame, `bridge/stream.go:37`). Direct calls
would put N goroutines into that map and require exactly the mutex the comment forbids, on the code
path that owns op-log integrity. The channel is the synchronisation. At op-log volumes — one row per
user-visible operation — the marshal cost is not worth trading for a mutex on a hand-audited
single-writer invariant. **P59 may revisit it with the whole tree in view; P58f does not.**

*Where the type goes.* `oplog.EventSource` is a consumer-declared interface (A11's discipline), so
its payload type belongs with the consumer: `internal/oplog` declares

```go
type Event struct { Topic string; Payload json.RawMessage }
const ( EventOpStart = "op:start"; EventOpEnd = "op:end" )
```

and `adapterhost.Host.Subscribe()` returns `<-chan oplog.Event`. `adapterhost` importing `oplog` for
one type creates no cycle (`oplog` imports `notify`, `storage/*` and nothing from `adapterhost`).
`enginehost.ErrStreamFull` becomes `adapterhost.ErrStreamFull` in `session.go`, where its only two
uses are.

*`internal/enginebackend` deletes entirely* (2 files, 131 lines). `Merge(a, b)` had exactly one
purpose — fanning the child's events together with the router's — and after M10 there is one
producer. `main.go:150` becomes `oplog.New(router.Host(), …)`.

*What replaces `EventEngineDown`.* Nothing publishes it after M10, and P58a's own answer for the
coexistence window (*"adapter-level connection loss and a shutdown sweep, both emitted by
`adapterhost` as ordinary `op:end` events"*) turns out to need only its second half:
`adapterhost.Host.RunOp` emits `op:end` on **every** exit path including a recovered panic
(`safeRun`, D16), so an in-flight op that fails for any reason already reconciles itself. The one
remaining case is **the process going away with ops in flight**.

The fix is three lines and no new mechanism: `Wiring.consume`'s `for evt := range events` loop
already ends when the channel closes, which `Wiring.Stop()`'s unsubscribe causes, which `main.go`'s
`teardown` already calls. Sweep after the range:

```go
for evt := range events { … }
w.finishInFlight(inFlight, "app exited")   // was handleEngineDown(inFlight)
```

— same body, different message string, reached on orderly shutdown instead of on a child's death.
`handleEngineDown` renames; `engineExitedError` becomes `appExitedError`. **A hard kill (`SIGKILL`,
OOM, panic outside `safeRun`) still leaves `running` rows**, exactly as it did before P58 for a
shell-process death; that is unchanged, not newly broken, and M11 records it in
`docs/ARCHITECTURE.md` rather than implying the sweep covers it.

`oplog/wire_test.go` drives `EventEngineDown` synthetically (`:190`); it re-points at the closed-channel
path, which is a smaller test than the one it replaces.

---

**P58f D10 — `connections.Service`'s engine-down watcher, `MarkAllErrored` and `Backend.IsNativeKind` are deleted, and the removal is recorded as a real behaviour removal rather than a cleanup.**

`Service.watch()` (`connections/service.go:157-166`) is the only caller of `MarkAllErrored`
(`:529`), which is the only consumer of `Backend.IsNativeKind` (`:44-47`), which is the only
consumer of `Router.IsNativeKind` (`router.go:102`). `Deps.Host *enginehost.Host` exists solely to
give `watch()` a `Subscribe()`. The whole chain is one subject: *"the engine process died, so every
connection it was serving is dead."*

After M10 there is no separate process that can die while the app lives, so the chain has no trigger
and no meaning. It deletes — `Deps.Host` field, `Start()`'s `go s.watch()`, `watch`, `MarkAllErrored`,
the `Backend` interface's fourth method, `Router.IsNativeKind`/`isNative`/`native`/`nativeKinds`,
`NewRouterAllNodeServed`.

**Recorded, not swept:** the app loses the ability to tell a user *"every connection just died at
once"*. Nothing replaces it, and nothing should — a Go adapter's connection loss is per-adapter and
surfaces per-connection through that adapter's own error mapping, which is strictly better
information. But `docs/ARCHITECTURE.md`'s Process-model section currently describes the child's
death as one of the architecture's virtues (bounded blast radius), and M11 must rewrite that
paragraph rather than delete it — the parent's §7 item 2 says so and it is the honest thing to do.

---

**P58f D11 — the data-plane `ping` is answered in-process; `EngineService.Status()` stays bound and reports this process; `AppInfo.Node` is removed.**

§1.9 established that **P58 D14 named the wrong surface**: the status pill reads
`request('ping')` on the data plane, not `EngineService.Status()`, which has zero renderer callers.

- `dataframe.go`'s `case "ping":` stops calling `forwardToChild` and answers locally with
  `{"pong": true, "enginePid": <os.Getpid()>, "at": <unix millis>}` — byte-compatible with
  `PingPayload` (`src/shared/protocol/port.ts:18-22`) and with what `rpc.ts:16-19` returns today, so
  `state/engine.ts` and `StatusBar.vue` need no change. A17's *"ping always forwards to the child"*
  rule and its comment delete with the child.
- `bridge/engine.go`'s `Status()` returns `{alive: true, pid: os.Getpid()}` unconditionally, per
  D14's own reasoning (*"the engine is this process now"*) — and stays bound, because deleting a
  bound service means regenerating bindings **and** editing `src/renderer/bridge/control.ts:108`,
  which buys nothing and widens P58f's `src/` diff for no user-visible gain. Retiring the pill is a
  UI decision for a later phase; the parent said so and it is still right.
- `bridge/app.go:34`'s `Node: s.Deps.NodeVersion` and `AppInfo.Node` delete (D14's second half),
  along with `appcore.Deps.NodeVersion` and `main.go`'s `nodeVersion()`. `control.appInfo` has zero
  renderer callers (P57 D7, re-checked: `src/renderer/shortcuts/keys.ts:3` mentions it only in a
  comment), so nothing observes the field's disappearance. `shell/frontend/bindings` regenerates.

`src/shared/protocol/ipc.ts`'s own dead `KiraApi`/`AppInfo` interfaces — pre-Wails `contextBridge`
leftovers that `docs/v1/SPEC.md`'s P52–P57 row names as still open — are **not** P58f's. They are
`src/shared` (D1's protected surface), they predate this phase, and P59's architecture round is where
a dead-interface audit belongs. M11 notes them as still open.

---

**P58f D12 — the Go cache's `cache:stats` push is wired into the session in M10, and this is a bug fix, not a deletion side effect.**

§1.7 established that the status bar's cache readout has been fed by an empty cache since P58a M5.
M10 must fix it because after M10 the readout has no producer at all.

`Router.AttachStream` subscribes the new session to `r.cache.OnStatsChanged`, marshals each
`CacheStats` into an event frame — `{"kind":"evt","topic":"cache:stats","payload":{…}}`, the exact
shape `port.ts`'s `handleMessage` dispatches on and `data.onCacheStats` consumes — and
`session.enqueueLocal`s it; `detach` unsubscribes. `enginecache`'s own 1 Hz throttle and its
`statsChanged` comparison already give the *"an idle app posts nothing"* property `cache/index.ts`
had (`cache.go`'s `scheduleEmitLocked`), so no new throttling is needed.

Deleting with the child: `observeChildEvent`, `statsMu`, `lastChildStats`, `haveChildStats`,
`mergedCacheStats` and A16's whole sum-both-caches apparatus. `respondCacheStats` keeps answering
the pull path with `r.cache.Stats()` directly, because `DATA_OP.cacheStats` is still a real op in
`data-ops.ts` even if nothing issues it.

*The gate:* this is the one M10 change with no automated coverage — `tests/ui/`'s mock has no
`Events.On` analogue (`AGENTS.md`'s P57 finding, and the cache-budget scenarios were moved to
`shell/internal/enginecache/*_test.go` for exactly this reason). So it needs a **manual check in
§6's list**: open the app, open a table, page it, and watch the status bar's cache size move off
zero. A Go unit test over `AttachStream` → a fake `StreamSession` capturing frames is worth having as
well, and clears `AGENTS.md`'s bar on the concurrency clause (a subscription's lifetime tied to a
session's).

---

**P58f D13 — `tests/ipc/`'s generator moves to `shell/internal/ipcfixture/`, drives the *real* bridge services, and the fixtures are regenerated with their diffs reviewed and attributed — not forbidden.**

This is P58 D13's port, §4 designs it, and this decision fixes two things the parent got wrong about
it.

*First, the parent's §8 criterion 5 is unachievable and must be amended.* §1.5's evidence: the
committed Kafka fixture freezes a "not available" string the Go adapter no longer produces and a
`type: CLASSIC` row it no longer emits, and `kafka.frontend.spec.ts:127` asserts a Configuration
section with zero rows against an adapter that now returns 32. Demanding an empty
`git diff --stat tests/ipc` would force one of two dishonest outcomes: freezing the Go generator's
output to reproduce a dead adapter's strings, or not regenerating at all and shipping a tier whose
anti-drift guarantee points at nothing. The criterion becomes:

> **Every changed line in every `*.fixture.ts` is attributed, in the regeneration commit's message,
> to a named behaviour change already recorded in a P58a–P58e plan or in `docs/ARCHITECTURE.md`. A
> `*.frontend.spec.ts` changes only where a fixture value it asserts on changed for such a reason,
> and each such change is listed by file and line.** An unexplained diff is a port bug, and stopping
> to explain it is the whole value of this exercise.

*Second, the Go generator reaches a layer higher than the TypeScript harness could, and that is a
gain worth claiming.* `tests/ipc/support/harness.ts:24-33` carries a 20-line **Map-backed stand-in**
for the tree cache-aside, written in P57 D15 because the real one had moved to Go and this tier was
TypeScript. Its own doc comment says the real semantics — persistence, the schema-mismatch drop, the
truncated-refresh rule — *"are asserted for real in `shell/internal/tree/service_test.go`; this
object deliberately implements none of them beyond hit/miss."* The Go generator drives
`internal/tree.Service` itself, whose `ChildrenResult`/`DescribeResult`/`DefinitionResult` JSON
shapes are already byte-identical to the fixture's (`{nodes, source, truncated}` etc., checked at
`tree/service.go:37-51`). The stand-in disappears and the fixtures get captured from the real
cache-aside for the first time.

*Third, the generator inherits the capture-tool role.* D15's two dev scripts die with the harness;
the Go generator's write mode replaces them, and `AGENTS.md`'s Docker section is rewritten to point
at it.

---

**P58f D14 — `tests/unit/catalog-listing.spec.ts` is ported to Go, not deleted, and the port extracts one small seam per adapter.**

§1.11: the truncation conjunction in `redis/catalog.go:193` and `s3/catalog.go:120` has no positive
Go coverage; the only Go assertion is the negative case. `AGENTS.md`'s bar keeps this test explicitly
(interacting rules, a boundary nobody can reach live without seeding 200 000 keys), and the parent's
own §5.1 rule — *"deleting a test whose subject moved is correct; the thing to check is that the Go
test actually covers the same assertion"* — is a rule about **checking**, not a licence.

The obstacle is that both Go functions take a concrete driver client (`*goredis.Client`,
`*s3.Client`) where the TypeScript took a duck-typed object the spec faked in a line. The port
extracts the one method each needs, as an unexported interface declared at the consumer:

```go
// redis/catalog.go
type scanner interface { Scan(ctx context.Context, cursor uint64, match string, count int64) *goredis.ScanCmd }
// s3/catalog.go
type prefixLister interface { ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) }
```

`*goredis.Client` and `*s3.Client` satisfy both structurally, so no call site changes; the tests get
a fake that returns a scripted round per call, exactly as the TypeScript did. Nine cases port;
`internal/adapters/{redis,s3}/catalog_test.go` are the successors; the TypeScript spec deletes in
the same commit its Go successor lands, per D12's own rule applied one last time.

*Named alternative, rejected:* delete it and record the loss. It would be the only genuinely
*untested* behaviour P58 removed coverage for, in a phase whose §7 already concedes that
*"14 847 lines of mature, container-tested code are rewritten and the tests that pinned them do not
port."* Adding one more loss to that list to save two interface declarations is a bad trade.

---

**P58f D15 — `scripts/capture-{tree,postgres-tree}.ts` are deleted, and the capture capability moves to the Go generator's write mode.**

Both scripts import `tests/ipc/support/harness.ts`, which imports `src/engine/{control,rpc}.ts`.
They are manual dev tools, not suite members, and their value — *"capture, don't hand-write"*, P50 D5
— is real: `AGENTS.md`'s Docker section names `capture-postgres-tree.ts` by path as the answer to
"I need a real captured shape for a `tests/ui/` fixture."

The Go generator (§4) already does exactly this for six adapters. M11 rewrites that `AGENTS.md`
paragraph to point at it, and §4.6 requires the generator's write mode to be usable for a one-off
capture (an adapter + a scenario list) rather than only for the six committed fixtures. That
preserves the capability with less machinery: one Go tool instead of two esbuild-bundled TypeScript
scripts that needed the vendored Node to dodge Bun's testcontainers hang.

---

**P58f D16 — `docs/v1/SPEC.md`'s P58 row keeps its Deliverable column verbatim, errors included; the correction goes in the third column.**

The parent's §1.2 and its §8 criterion 12 both say M11 *fixes* the row's missing `sqlite`. That
contradicts `docs/v1/README.md`'s own rule —

> *"Both are kept exactly as originally written. Neither is retro-edited to track a later change…
> The one part of this folder still being added to is `SPEC.md` §10, the phasing table: every phase…
> gets a row recording what changed and why, and that ledger keeps accruing rows — it just does not
> otherwise change what earlier phases already said about themselves."*

— and it contradicts the parent plan's **own amendment note**, which says the opposite about the same
row in the same breath (*"The SPEC.md quote above stays verbatim (docs/v1/ is never retro-edited) —
it is a historical record of what v1 originally specified, not a current scope statement"*).

Resolved in favour of the README's rule, which is the repo's own standing policy and which the parent
plan itself invokes:

- **Column 2 ("Deliverable") is untouched.** It keeps `rabbitmq` and keeps omitting `sqlite`. That is
  what was specified, and it being wrong is a fact about the specification, not a typo to launder.
- **Column 3 is rewritten** from `Not yet planned — queued` to the implementation record, on the
  P52–P57 row's own pattern, and **that** is where both corrections are stated: the row named ten
  kinds and omitted `sqlite` (eleven at the time, and `registry.ts` had eleven loaders); RabbitMQ was
  dropped from v1 entirely mid-phase and never ported; ten kinds shipped native across six
  sub-phases; here is the per-sub-phase summary and the pointer to each plan's own §12/§13.

M11 therefore satisfies criterion 12 by *recording* the correction rather than by *making* the edit
the criterion literally asks for, and says so in the commit message.

---

**P58f D17 — `docs/ARCHITECTURE.md` is rewritten section by section against a grep-shaped criterion, not a prose one.**

P58d OQ-2's lesson, adopted: the ARCHITECTURE mapping-table edit was required by two consecutive
sub-phases' acceptance criteria and made by neither, *"which suggests the criterion's form is the
problem, not anyone's diligence."* P58d fixed it by phrasing the criterion as a grep; P58e kept that
form; P58f keeps it and extends it to the whole file (§6 criterion 12).

The edits M11 owes, each with the §1.13 finding it answers, plus the ones the parent's §8 criterion
12 already named:

1. **Invariants** — the bulk-data rule is replaced with P58 D3's text (§1.13 item 1), resolving the
   contradiction with the Process-model section, and the "Go never unmarshals a data-plane frame"
   sentence goes with it.
2. **Stack** — the Engine build / Engine runtime rows delete; the "Package manager" row's *"the
   engine runs on a vendored real Node"* becomes `AGENTS.md`'s *"Bun is tooling only"*, now
   literally true (parent §7-better item 7); the Validation row's TypeScript half narrows to
   connection-dialog input (D17 of the parent); the driver line's `mattn/go-sqlite3` becomes
   `modernc.org/sqlite` **and claims the cgo-free product code** (§1.13 item 2); the Logging row
   drops the engine-child clause; the DB-tests row is rewritten (the Node tier is gone).
3. **Adapter contract** — rewritten against `shell/internal/adapters/`, closing P58a OQ-6: the
   `Adapter` interface's Go home, `Caps` in `adapters/caps.go`, `registry.go`'s constructor map, and
   **the lazy-`import()` sentence deleted rather than translated** — Go links every adapter into the
   binary, there is no per-engine baseline-memory story left, and pretending otherwise would be the
   exact kind of stale claim this pass exists to remove.
4. **Per-engine facts** — Kafka's section gains D6's re-rendered preview text and keeps D5's named
   regression; SQLite's gains the modernc/cgo-free fact.
5. **Process model** — three processes become two; the ASCII diagram loses the engine box and the
   stdio arrow; *"Why a separate engine process"* is **rewritten to record what was lost** (parent
   §7 item 2: a driver panic now takes the app down, `recover()` converts most but not all of it),
   not deleted; the `--max-old-space-size` paragraph goes with D18; `AnchorNeedles`' second entry
   (`runtime/node/bin/node`) goes; the *"Under the stdio transport, stdout is the frame channel"*
   paragraph goes; the **"Known regression"** paragraph is replaced by the measured fix, pointing at
   `docs/PERF.md` §2.5 (§1.13 item 5); the D10 blast-radius change from D9/D10 is noted.
6. **Caching** — L2/L3 move from "in the engine" to "in the Go process"; D12's push wiring is what
   makes the Observability sentence true again.
7. **Testing** — `tests/db/` is redescribed as the shared fixture corpus (D1); `tests/ipc/` is
   redescribed with a Go backend half and the anti-drift sentence kept **word for word** (D13);
   `tests/e2e-real/` becomes three specs and loses its vendored-Node prerequisite.
8. **The parent's own §7 lists are amended** in the same pass, since three sub-phases asked and none
   did: MySQL's `allowPublicKeyRetrieval` removal joins "what gets worse" as the phase's first
   security-posture regression (P58b OQ-4); Mongo's `$numberDouble` rendering fidelity joins "what
   gets better" (P58c OQ-4); the parent's §5.5 S3-download e2e proposal is struck as structurally
   unbuildable (P58d OQ-5).

---

**P58f D18 — `advanced.engineMemoryCapMb` is removed end to end in M10, which makes P58f's `src/` diff three files, and the parent's §7 enumeration is amended to say so.**

The parent contradicts itself: §7 opens with *"`src/` changes, enumerated: `port.ts`'s `toTypedArray`
body, and the deletion of `src/engine/`. That is the entire list"* and then item 3 says the setting
*"should be removed rather than left in the settings dialog doing nothing."* Both cannot hold.

Resolved in favour of removal. A settings control that writes a value nothing reads is worse than any
diff-size consideration, and it is the only such control the phase creates. Checked (§1.15): **no
test in either language references it**, so the change is mechanical:

- `src/renderer/workbench/SettingsDialog.vue` — the label, the input and the `patchSettings` call
  (`:95`, `:302-309`).
- `src/shared/domain/settings.ts` — the leaf, the `advanced` default and the seed default
  (`:31`, `:42`, `:68`).
- `shell/internal/storage/model/settings.go` — the field, the patch field, the validator
  (`:21`, `:44`, `:69`, `:102`, `:120`).
- `shell/internal/storage/repos/settings.go` — the `leafValid` read and the patch upsert
  (`:60`, `:111-112`).
- `shell/main.go` — the `--max-old-space-size` argument goes with `enginehost.Start`.

**No migration.** Settings are stored as leaf rows; an orphan `advanced.engineMemoryCapMb` row in an
existing user's database is inert once nothing reads it, and a schema version bump to delete one row
is not worth the migration-ordering risk. M11 records the orphan in `docs/ARCHITECTURE.md`'s Storage
section so nobody later "discovers" it.

So P58f's `src/` diff is: `port.ts` (D8), `SettingsDialog.vue` (D18), `settings.ts` (D18), plus the
deletion of `src/engine/`. Four entries, enumerated, and §6 checks them.

---

## 4. The `tests/ipc/` fixture-generator port (P58 D13), concretely

The parent's M10 bullet: *"D13's fixture-generator port, which must be green **before** the
TypeScript backend specs are deleted, not after."* This section is what has to exist for that to be
checkable.

### 4.1 What the tier actually is, restated from the code

Per adapter, three files. `<adapter>.backend.spec.ts` drives a real container and produces two
arrays; `<adapter>.fixture.ts` is those two arrays, committed; `<adapter>.frontend.spec.ts` drives
the real Vue UI with both wire planes mocked **from that same file**. The guarantee, stated once in
`docs/ARCHITECTURE.md` and reproduced verbatim in every fixture's generated header:

> *a frontend spec cannot mock a shape the backend has stopped producing without that same fixture
> module's own backend assertion failing first.*

The two arrays (`tests/ipc/support/types.ts`):

- `ControlSnapshot { channel, args?, response?, error? }` — `channel` is a value from
  `src/shared/protocol/ipc.ts`'s `IPC` map (`'kira:connections:connect'`, `'kira:tree:children'`, …),
  i.e. **a renderer-facing bridge channel**, not an engine op. `args` is exactly what the renderer
  sends.
- `PortSnapshot { op, payload, response?, error?, delayMs? }` — `op` is a `DATA_OP` value; `response`
  is a **logical** page (`LogicalPage`: rows as `(string|null)[][]`), never the encoded chunks, with
  `fetchedAt`/`byteSize` deliberately dropped (P50 D6).

The TypeScript backend half reached this by calling `control.handleFrame`/`rpc.dispatch` directly and
hand-rolling the two things those did not cover: a `connectionSummaryOf(config)` that fabricates the
`connectionsList` response, and a Map-backed tree cache stand-in.

### 4.2 Where the Go successor lives, and what it drives

**`shell/internal/ipcfixture/`** — one package, six `_test.go` files plus shared machinery. It needs
only the Go toolchain and Docker: `internal/{bridge,tree,connections,adapterhost,enginecache,storage,page}`
and `internal/adapters/testsupport` — **none of which imports Wails** (verified:
`grep -rn wailsapp internal/{bridge,tree,connections,adapterhost}/*.go` returns nothing; `bridge`
imports no Wails by P56 D1's own rule). So the fast loop is
`go test ./internal/ipcfixture/ -run TestFixture_MariaDB`, with no GTK/WebKit headers.

Per adapter, the test builds the **real app stack** in a temp `KIRA_HOME`:

```
storage.Open()  →  repos.New()
enginecache.NewCache(64<<20, log)
adapterhost.NewRouter(deps, cache, repos.Connections)          // post-M10 signature: no child
connections.New(connections.Deps{Conns, Secrets, Metadata, Cipher, Backend: router, Preconnect})
tree.New(repos.Connections, repos.Metadata, router, connectionsSvc)
bridge.{ConnectionsService, TreeService, OpsService}{Deps: appcore.Deps{…}}
```

and then calls **the bridge services** for control-plane snapshots and
`router.HandleDataFrame` / `router.dispatcher` for data-plane ones. That is a strictly higher-fidelity
subject than the TypeScript harness had: the real `connections.Service` produces the real
`connectionsList`/`connectionsConnect` responses (no `connectionSummaryOf` fabrication), and the real
`tree.Service` produces the real `source: 'cache'|'server'` transitions from the real
`metadata_cache` table (no stand-in). D13's own §5.6 regenerate-and-diff guard becomes cheap:
the assertion path and the write path are the same code, gated on an env var.

`t.Setenv("KIRA_INSECURE_SECRETS", "1")` is required on Linux (`AGENTS.md`'s Secrets section), the
same way `tests/e2e-real/`'s fixture sets it.

### 4.3 The four pieces of shared machinery

**(a) `channels.go` — the `IPC` string table.** One `map[string]func(args json.RawMessage) (any, error)`
per harness instance, mapping each `IPC.*` wire literal to the bridge method that answers it. This is
the direct successor to `enginehost/ops.go`'s own constant table and it earns the same discipline:
**grep `src/shared/protocol/ipc.ts` for each literal; never infer it from the TypeScript identifier**
(`AGENTS.md`'s P52–P56 finding, which was earned on `ENGINE_OP.configureCache` being
`'cache:configure'` and not `'engine:configure-cache'`). Six channels cover every committed fixture:
`connectionsList`, `connectionsStates`, `connectionsConnect`, `treeChildren`, `treeDescribe`,
`treeDefinition` — plus `opsCancel` where a spec captures it. The M10 implementer must re-derive the
list from the six committed fixtures rather than from this paragraph.

**(b) `decode.go` — the logical-page decoder.** The Go analogue of `tests/ipc/support/decode.ts`,
built on `page.IsNull` / `page.CellText` / `page.IsTruncated` (`internal/page/chunk.go:89-99`) —
never a hand-rolled re-implementation, exactly as P50 D6 required of the TypeScript one. Four page
kinds, each with its own field names (`rows`; `ids`/`bodies`; `redisType`/`ttlMs`/`memoryBytes`/
`fields`/`values`; `keys`/`headers`/`attrs`/`timestamps`/`bodies`/`visibilityTimeoutSeconds`).
`fetchedAt` and `byteSize` are dropped. `truncatedRows` is emitted **only when something is
truncated** — `types.ts` documents its absence as meaning "nothing truncated", and emitting an empty
array everywhere would churn every fixture.

**(c) `write.go` — the module writer.** Emits the same two `export const` declarations with the same
header comment (its provenance line updated to name the Go generator). Three traps, each of which
would otherwise be found by a confusing diff:

- **Go's `encoding/json` escapes `<`, `>` and `&` as `<`/`>`/`&` by default.** The
  fixtures contain SQL and JSON text. Use `json.Encoder` with `SetEscapeHTML(false)`.
- **Go sorts `map` keys and preserves `struct` field order.** Every snapshot type must be a struct
  with fields declared in the order the renderer's own builder produces them — **never**
  `map[string]any`. This is not cosmetic: `AGENTS.md`'s P57 finding records that
  `mockRuntime.ts`'s `canonical()` sorts only *top-level* keys, so a nested `args` object whose key
  order differs from the real call's still 422s as `E_FIXTURE_MISS`. When in doubt, run
  `test:ipc:fe` once — the miss message echoes `JSON.stringify(callArgs)` verbatim.
- **`json.MarshalIndent(v, "", "  ")` is close to `JSON.stringify(v, null, 2)` but not identical.**
  It does not have to be: `bunx biome check --write` runs over the written file afterwards and
  normalises formatting without reordering keys — the same step `AGENTS.md` already prescribes for
  the TypeScript writer. Biome must run before the file is committed and before `bun run lint`.

**(d) `frozen.go`, per adapter — the named non-determinism list.** D13's §5.6 second guard
(*"every frozen field is named… in one place, so a new non-determinism produces a diff rather than a
silent freeze"*). Carried over from the TypeScript specs, re-derived at implementation time:

| Adapter | Frozen | Why |
|---|---|---|
| all six | connection summary `host`→`'fixture-host'`, `port`→`0`, `createdAt`/`updatedAt`→a fixed ISO, `since`→`0` | Testcontainers assigns a fresh host port every run |
| kafka | coordinator `host`→`'fixture-broker-host'`, `port`→`0`; the page sorted by key (`sortStreamByKey`) | a read fans across both partitions and interleaves by arrival, not by key/offset (`AGENTS.md`'s `tests/ipc/` section) |
| clickhouse | the materialized view's `.inner_id.<uuid>` | generated per container |
| redis | HSCAN field order and per-round counts | *not stable across two identically-seeded fresh containers* — reconfirmed independently in P58c M7.0 against a real Go client |
| all six | any `serverVersion` matched by pattern rather than compared | image tags move |

### 4.4 The known fixture diffs, before anyone runs it

So the regeneration commit's message has a starting point rather than a surprise:

| Adapter | Expected diff | Attribution |
|---|---|---|
| kafka | topic definition's Configuration section: the "not available" note (`:151`) replaced by real config rows; the section's own `Section` entry (`:172`) gains rows | **P58e E11** / P58 D7 — a recovered capability |
| kafka | group definition (`:195`, `:226`): `type` row gone, `partitionAssignor` merged into `protocol` | **P58e E13** / **P58f D5** |
| kafka | `kafka.frontend.spec.ts:127`'s `toHaveCount(0)` → the real row count | consequence of the above; **the one frontend-spec change P58f expects** |
| all six | `caps` in `connectionsConnect.response.caps` | compared field-by-field against each Go `Caps()` literal; any difference is a **port bug** unless it is a plan-recorded change |
| all six | tree `source` values | now from the real `tree.Service` cache-aside rather than the Map stand-in; hit/miss should agree, but a truncated listing is now genuinely not cached (P43 iter3 D38) where the stand-in also did not cache it — verify, do not assume |
| any | a snapshot carrying a driver error message | Adapter rule 4 preserves the *server's* text, and the Go driver words it differently — re-baseline, never loosen |

Anything **not** in this table that diffs is a finding, and the M10 implementer should stop and say
so rather than regenerate over it. That is the same instrument P58's own §5.2 uses for `src/`.

### 4.5 Ordering, and the one commit where `bun run test:ipc:be` is red

The parent's rule — *the port must be green before the TypeScript backend specs are deleted* — has a
wrinkle: the moment the fixtures are regenerated, the still-present TypeScript backend specs assert
against a file that no longer matches what a TypeScript adapter produces, so `test:ipc:be` goes red.
That is unavoidable and it is not a violation; what the rule protects against is deleting the old
tier on a promise. The honest sequence (§6's commits 12–15):

1. **The apparatus plus one pilot adapter, in read mode, green against the *committed* fixture.**
   MariaDB, for the same reason P50 itself chose it. This is the single strongest possible proof of
   the port: **a Go generator reproducing, byte for byte, a fixture captured from the TypeScript
   adapter.** If MariaDB's fixture needs *any* change, that is a signal to investigate before
   touching the other five. No fixture is written and nothing is deleted.
2. **The remaining five, same discipline**, each attributing any diff.
3. **Regenerate all six + the one frontend-spec change**; `bun run test:ipc:fe` and `bun run test:ui`
   green. `test:ipc:be` is red from here, and the commit message says so and why.
4. **Delete the TypeScript backend half** in the very next commit, along with `test:ipc:be`,
   `test:ipc`, and `scripts/run-ipc-backend.sh`. Red window: one commit.

### 4.6 What the write mode must also serve (D15)

`KIRA_IPC_FIXTURES=write` becomes a Go env check with the same name and value, so the muscle memory
and the `AGENTS.md` line survive. Beyond the six committed fixtures, the generator must be usable for
a **one-off capture** — an adapter plus an ad-hoc scenario list, printing a logical page or a tree
result to stdout — because that is what `scripts/capture-{tree,postgres-tree}.ts` did and what
`AGENTS.md`'s Docker section names by path. A `-run TestCapture_<Adapter>` test reading a scenario
JSON from an env var or a `testdata/` file is enough; it does not need the two scripts' full recipe
grammar, and M11 rewrites the `AGENTS.md` paragraph to describe whatever actually lands.

---

## 5. The verified M10 deletion list

Re-derived at `1834afc`. Where this disagrees with the parent's §1.12 or §3, the disagreement is
called out in the right-hand column.

### 5.1 TypeScript

| Path | Size | Note |
|---|---:|---|
| `src/engine/**` | 110 files / 13 637 lines | parent says 119 / 14 847 (§1.1) |
| `tests/db/{clickhouse,mariadb,mysql,sqlite}.spec.ts` | 6 765 | **P58f D1**; parent expected these gone by M7 |
| `tests/db/support/{page,clickhouse,mysql,sqs,mongo,redis}.ts` | ~700 | by consumer count (§1.3) |
| `tests/db/fixtures/{0003_mongo,0004_redis,0006_sqs}_seed.ts` | 170 | ditto |
| `tests/db/tsconfig.json` | — | with `typecheck:db` |
| `tests/ipc/*/*.backend.spec.ts` (6) | 1 797 | **only after §4.5 step 3** |
| `tests/ipc/clickhouse/container.ts` | 138 | its `NoUlimitClickHouseContainer` workaround has a Go counterpart or none — check `testcontainers-go`'s module, per the parent's §4.10 |
| `tests/ipc/support/{harness.ts,harness.spec.ts,capture.ts,decode.ts}` | 417 | `types.ts` **stays** — 24 `tests/ui/` files import it |
| `tests/unit/catalog-listing.spec.ts` | 145 | **P58f D14** — after its Go successor is green |
| `scripts/capture-tree.ts`, `scripts/capture-postgres-tree.ts` | 479 | **P58f D15**; in no plan's list |
| `scripts/{vendor-node,run-ipc-backend,run-db-tests}.sh` | 134 | |

**Explicitly kept**, against the parent's §3: `tests/db/fixtures/*.sql` (5 files, Go reads them by
path), `tests/db/support/{docker,postgres,mariadb,sqlite,kafka}.ts` + `fixtures/0005_kafka_seed.ts`
(`tests/e2e-real/` re-exports them), `tests/ipc/**/*.fixture.ts` (regenerated, not deleted),
`tests/ipc/**/*.frontend.spec.ts` (one edit), `tests/ipc/support/types.ts`, all of `tests/ui/`
(one edit, D8).

### 5.2 Go

| Path | Size | Note |
|---|---:|---|
| `shell/internal/enginehost/**` | 10 files / 1 197 lines | `Event`+topics → `oplog`, `ErrStreamFull` → `adapterhost` (**D9**), before deletion |
| `shell/internal/enginetest/**` | 2 files / 309 | includes the 242-line `engine-fixture.mjs` |
| `shell/internal/enginebackend/**` | 2 files / 131 | **not in any plan's list** — one producer left (**D9**) |
| `shell/internal/adapterhost/router.go` | ≈ 190 of 462 | `child`, seven `*ViaChild`, `native`/`nativeKinds`/`isNative`/`IsNativeKind`, `NewRouterAllNodeServed`, `noteChildRoute`/`ChildRoutes`/`childRoutes` (**D2**), `PushCacheConfig`'s child half |
| `shell/internal/adapterhost/dataframe.go` | ≈ 60 | `forwardToChild`, `observeChildEvent`, `mergedCacheStats`, `statsMu`/`lastChildStats`/`haveChildStats`; `ping` answered locally (**D11**); `cache:stats` push added (**D12**) |
| `shell/internal/adapterhost/integration_test.go` | 43 | its subject is `forwardToChild` against a real Node child — **deleted, not rewritten** |
| `shell/internal/connections/service.go` | ≈ 35 | `Deps.Host`, `Start`'s `go s.watch()`, `watch`, `MarkAllErrored`, `Backend.IsNativeKind` (**D10**) |
| `shell/internal/connections/service_test.go` | 5 tests | rewritten onto a fake `connections.Backend` — the two-line stub the `Backend` interface's own doc comment says is the point. Loses `fixture:last-connect-config`, `fixture:release-slow`, `fixture:request-count` |
| `shell/internal/tree/service_test.go` | 2 tests | rewritten onto a fake `tree.Backend` |
| `shell/internal/oplog/wire.go` + `wire_test.go` | ≈ 15 | `Event`/topics declared here now; `handleEngineDown` → a sweep on channel close (**D9**) |
| `shell/internal/appcore/deps.go` | 2 fields | `EngineHost`, `NodeVersion` |
| `shell/internal/bridge/engine.go`, `app.go` | ≈ 10 | **D11** |
| `shell/main.go` | ≈ 70 | `resolveEngine` (31), `firstExisting` (9), `nodeVersion` (8), the `enginehost.Start` block (14), `enginebackend.Merge`, `--max-old-space-size` (**D18**), and the now-unused `os/exec`/`strings`/`path/filepath` imports |

`shell/go.mod` loses nothing — `enginehost` had no external dependencies.

### 5.3 Config, build, packaging

| Path | Change |
|---|---|
| `package.json` | `dependencies` → `{"zod": …}` alone (10 removed: `@aws-sdk/*` ×3, `@clickhouse/client`, `@confluentinc/kafka-javascript`, `bson`, `ioredis`, `mariadb`, `mongodb`, `pg`). `trustedDependencies` → `["esbuild"]` or removed entirely — **check whether `esbuild` still has a `bunx` consumer after `run-ipc-backend.sh` and `build:engine` go; it likely does not**. `devDependencies` lose `@types/pg` and `@testcontainers/{clickhouse,mysql,redis,localstack}` (their only consumers were the deleted support modules); `@testcontainers/{postgresql,mariadb,kafka}` and `testcontainers` **stay** (`tests/e2e-real/`). Scripts lose `build:engine`, `test:db`, `test:ipc`, `test:ipc:be`, `typecheck:db`; `typecheck` drops `typecheck:db` |
| `tsconfig.node.json` | `include` loses `src/engine/**/*.ts` and `tests/db/support/**/*.ts` |
| `biome.json` | the two `src/engine/adapters/**` overrides (`:103-122`, `:123-146`) delete — **in no plan's list** (§1.12) |
| `shell/build/darwin/Taskfile.yml` | the `runtime/{node,engine}` guard and `cp -R runtime` (`:170-180`) — **in no plan's list** |
| `scripts/verify-packaging.sh` | A1's nested target, A2, A4, N1 (**D4**) |
| `scripts/sign-bundle.sh` | the `NODE_BIN` fail and its `codesign`, the `KAFKA_NATIVE` block (**D4**) |
| `scripts/wails-dev-setup.sh` | the two prerequisite checks (**D4**) |

### 5.4 The three Go test files that drive a real Node subprocess

`enginetest.Host(t)` boots `testdata/engine-fixture.mjs` under a real Node. Its three consumers are
the last Node dependency in the Go suite, and after M10 the whole Go test suite runs on the Go
toolchain plus Docker and nothing else — worth claiming in `AGENTS.md`.

- **`adapterhost/integration_test.go`** — `TestForwardToChild_RealEngineChild`. Its own comment says
  it exists to prove *"the seam where `Router.AttachStream` wires a Session in as the child's Sink
  and `forwardToChild` calls `SendData`"*. Both halves delete. **Delete the test**; there is nothing
  left to test and inventing a replacement would be ceremony.
- **`connections/service_test.go`** (5 tests) — rewritten onto a fake `connections.Backend`. Three
  tests use fixture-only ops that have no successor: `fixture:last-connect-config` becomes the fake
  recording its last `cfg`; `fixture:release-slow` becomes the fake blocking on a channel the test
  closes (which is a *better* instrument — no subprocess, no framing); `fixture:request-count`
  becomes a counter on the fake. All three get simpler.
- **`tree/service_test.go`** (2 tests) — rewritten onto a fake `tree.Backend`. Note its
  `seedConnection` inserts `kind = "kafka"`; with no kind-routing left, any valid kind does.

### 5.5 Scope, in one line

Roughly **24 000 lines deleted** (13 637 TypeScript engine + 6 765 `tests/db` specs + ~2 500 other
TypeScript + ~1 900 Go), against roughly **1 500 lines added** (the Go fixture generator, the two
`catalog_test.go` ports, D12's push wiring, the three rewritten Go test harnesses).

---

## 6. Sequencing

Nineteen commits across two milestones. The parent's hard rules that still apply: **R1** is
satisfied (checkpoint C2 recorded, P58e M9.4). **R3**'s spirit — a successor test lands and is green
before its predecessor is deleted — governs commits 12–16 and 18. M11 is last so it describes what
actually landed.

### M10 — the deletions

**Phase 1: the two behavioural changes, before any deletion, each on its own.**

1. `fix(cache): push Go-side cache:stats to the renderer` — **P58f D12**. The status-bar readout
   starts reporting the cache that actually serves pages. Its own commit and first, because it is a
   bug fix with a manual verification step, and burying it in a deletion diff would guarantee nobody
   checks it.
2. `feat(kafka): render the produce preview against the Go API` — **P58f D6**. One function body,
   one comment deleted, one Go acceptance assertion added. Its own commit because it is the only
   user-visible string change in the milestone.
3. `test(adapters): port the catalog truncation tests to Go` — **P58f D14**. Two unexported seam
   interfaces, two `catalog_test.go` files, nine cases; `tests/unit/catalog-listing.spec.ts` deleted
   in the same commit, because D12's rule is "deleted when its successor passes" and here they are
   the same change.

**Phase 2: the decoder narrowing.**

4. `refactor(port): decode base64 chunks only — the Node encoding has no producer` — **P58f D8**.
   `port.ts` and `mockStreamBrowser.js` together; `test:ui` + `test:ipc:fe` are the gate. One commit
   because either file alone is red.

**Phase 3: the Go seam, before the sidecar.** Each of these leaves the tree green with the child
still running, which is what makes the deletion in phase 4 mechanical rather than exploratory.

5. `refactor(oplog): own the op-event type; retire enginebackend` — **P58f D9**'s first half. `Event`
   + topics move to `internal/oplog`, `adapterhost.Host.Subscribe` re-types, `ErrStreamFull` moves to
   `adapterhost`, `internal/enginebackend` deletes, `main.go` wires `oplog.New(router.Host(), …)`.
   The child still runs and still publishes into the same shape; only the type's home changes.
6. `refactor(oplog): reconcile in-flight ops when the event stream closes` — **P58f D9**'s second
   half. `handleEngineDown` → `finishInFlight`, reached on channel close; `wire_test.go` re-points.
   Separate from 5 because 5 is a pure move and this is a behaviour change to the reconciliation
   trigger.
7. `refactor(bridge): the engine is this process` — **P58f D11**. `dataframe.go` answers `ping`
   locally, `EngineService.Status()` reports this process, `AppInfo.Node`/`Deps.NodeVersion`/
   `main.go`'s `nodeVersion` go. Bindings regenerate. Lands **before** the child is deleted so the
   pill is provably still green in a build that still has a child — the last moment that can be
   checked against the old behaviour.
8. `refactor(settings): remove the engine memory cap` — **P58f D18**. Five files across both
   languages. Its own commit because it is the phase's only settings-schema change.

**Phase 4: the sidecar.**

9. `refactor(adapterhost): serve every kind in-process, unconditionally` — the router's child half:
   `child`, the seven `*ViaChild` methods, `native`/`nativeKinds`/`isNative`/`IsNativeKind`,
   `NewRouterAllNodeServed`, `forwardToChild`, `observeChildEvent`, `mergedCacheStats`, and
   **checkpoint C2's counter** (**P58f D2**). `Router.Cancel` collapses to `h.CancelOp` — note that
   this is where P58a A13's op-ownership discriminator stops being a discriminator at all, which is
   the only way it can never be "simplified" into a kind lookup (P58a OQ-2).
10. `refactor(connections): no engine process, no MarkAllErrored` — **P58f D10**, plus
    `connections/service_test.go` and `tree/service_test.go` rewritten onto fakes and
    `adapterhost/integration_test.go` deleted. One commit because the `Backend` interface's shape
    changes and its three test consumers must move with it.
11. `refactor(shell): delete the Node engine sidecar` — `internal/enginehost/`, `internal/enginetest/`,
    `main.go`'s `resolveEngine`/`firstExisting`/`enginehost.Start` block, `appcore.Deps`'s two
    fields. **After this commit the app no longer spawns a child process.** The manual boot check
    (§7) belongs to this commit's message.

**Phase 5: the `tests/ipc/` port (§4.5).**

12. `test(ipc): a Go fixture generator, proven against the committed mariadb fixture` — the package,
    `channels.go`, `decode.go`, `write.go`, `frozen.go` and the MariaDB test, in **read mode**,
    asserting against the fixture the TypeScript captured. **Nothing is written and nothing is
    deleted.** The commit message quotes the byte-for-byte match, or names every divergence.
13. `test(ipc): the remaining five adapters' Go generators` — clickhouse, kafka, mysql, redis, sqs,
    each attributing its divergences.
14. `test(ipc): regenerate every fixture from the Go stack` — the six fixtures written, the one
    `kafka.frontend.spec.ts` assertion changed, `bunx biome check --write` run, `test:ipc:fe` and
    `test:ui` green. **The commit message states that `bun run test:ipc:be` is red from here to the
    next commit, and why.**
15. `test(ipc): delete the TypeScript backend half` — six `*.backend.spec.ts`, `container.ts`,
    `support/{harness,harness.spec,capture,decode}.ts`, `scripts/run-ipc-backend.sh`,
    `package.json`'s `test:ipc:be`/`test:ipc`.

**Phase 6: what was holding up the rest.**

16. `test: retire tests/db's four remaining specs` — **P58f D1**. The four specs, the six orphaned
    support modules, the three orphaned `.ts` seed fixtures, `tests/db/tsconfig.json`,
    `scripts/run-db-tests.sh`, `package.json`'s `test:db`/`typecheck:db`. The commit message carries
    the re-grep that proves each kept file still has a consumer.
17. `test(e2e-real): two native kinds in one session` — **P58f D3**.
18. `refactor: delete src/engine` — 110 files, 13 637 lines, plus `tsconfig.node.json`'s include,
    `biome.json`'s two overrides, `package.json`'s ten dependencies + `@types/pg` +
    `trustedDependencies` + `build:engine`, and `scripts/capture-{tree,postgres-tree}.ts`
    (**P58f D15**). **Last, deliberately** — it is the commit that makes every preceding one
    irreversible, and by the time it lands nothing imports what it removes.
19. `build: no vendored Node, no engine bundle` — **P58f D4**: `scripts/vendor-node.sh`,
    `wails-dev-setup.sh`, `sign-bundle.sh`, `verify-packaging.sh`,
    `shell/build/darwin/Taskfile.yml`. Separate from 18 because it is the packaging surface and
    because §7's macOS checks are all against this commit.

### M11 — documentation and CI

20. `docs: ARCHITECTURE — one process fewer, one adapter layer, one encoding` — **P58f D17**'s eight
    items, checked by §7's greps.
21. `docs: PACKAGING and PERF against a bundle with no runtime/` — `docs/PACKAGING.md` per D4;
    `docs/PERF.md`'s L-D lever, §2.2/§2.3 RSS rows, the §1 budget table's engine references, and the
    stale `tests/unit/engine-cache.spec.ts` reference at `:171` (that file has not existed since
    P58a M3). New bundle-size/RSS numbers if macOS is available, an explicit "not available in this
    session" line if not.
22. `docs: P58f findings, and P58's own closeout` — `AGENTS.md`'s P58f entry (§7 criterion 11's
    list), its rewritten Docker / `tests/ipc/` / SQLite / Wails-Go sections, the two stale
    `mattn/go-sqlite3` cgo claims (`:205`, `:238`), plus **amendment notes appended to
    `docs/v1/plans/P58-go-native-adapters.md`** for C2's definition (D2), D6/D8's superseded driver
    rows, D13's amended criterion, D14's corrected premise, §5.5's struck proposal, and §7's three
    amended list entries.
23. `docs: SPEC.md — the P58 row's outcome` — **P58f D16**. Column 2 untouched; column 3 rewritten.
24. `ci: workflows for a build with no Node` — **P58f D17**/the parent's §4.9. Landed if the
    session's push scope allows; otherwise the staged directory gains a P58-current revision
    (renamed from `p57-pending-ci-workflows/`, since it is no longer P57's), and `AGENTS.md`'s own
    finding is updated to say the update is *still* pending and now two generations behind.

---

## 7. Acceptance — "P58 is done"

The parent's §8 lists twelve criteria for the whole phase. **Criteria 1–4 are already satisfied by
P58a–P58e**; criteria **5–12 are P58f's and none is satisfiable before it completes.** The M9.4
agent's own final report claimed *"§8 criteria 5-10 were correctly P58f's and untouched"* —
**cross-checked, and that claim is right as far as it goes but two short**: criteria 11 and 12
(`AGENTS.md`'s findings entry and `docs/ARCHITECTURE.md`'s update, including the rewritten bulk-data
invariant) are also P58f's, and criterion 10's `docs/PERF.md` half is *partly* discharged already
(P58a M2 recorded the re-taken inflation measurement in §2.5; the bundle-size and RSS halves are
still owed).

| # | Parent §8 criterion | Status | P58f's obligation |
|---|---|---|---|
| 1 | C1 recorded | **done** (P58a §7) | none |
| 2 | C2 recorded before M10 | **done** (P58e §13, `AGENTS.md`) | ratify the amended definition (**D2**) |
| 3 | lint, typecheck, test:unit, test:go, test:ui, test:ipc:fe green | re-run | `typecheck` is now three projects, not four (`typecheck:db` goes); `test:ipc:be`/`test:db` no longer exist |
| 4 | `go test ./internal/adapters/...` green per engine, or Docker stated | **done** per sub-phase | re-run; state unavailability per engine |
| 5 | no `tests/ipc` fixture or frontend-spec change | **not satisfiable — amended by D13** | every fixture diff attributed by name; exactly one frontend-spec assertion changed (`kafka.frontend.spec.ts:127`), listed |
| 6 | `git diff --stat src/` empty except `port.ts` | **not satisfiable — amended by D18** | the whole-phase `src/` diff is `port.ts`, `SettingsDialog.vue`, `shared/domain/settings.ts`, plus `src/engine/`'s deletion. **P58f's own commits touch exactly those three files** |
| 7 | `grep -rn "enginehost\|vendor-node\|build:engine\|runtime/node\|src/engine" shell/ src/ scripts/ package.json docs/ tests/` returns nothing outside `docs/v1/plans/` and `AGENTS.md`'s findings logs | **P58f** | the phase's single sharpest instrument. Run it and paste the output |
| 8 | `package.json`'s `dependencies` is `{"zod"}`; `trustedDependencies` gone | **P58f** | plus `@types/pg` and four `@testcontainers/*` devDependencies |
| 9 | a signed bundle with no `Contents/MacOS/runtime/`; `verify:packaging` exits 0 | **P58f, macOS only** | otherwise recorded as unavailable, per the parent's §6 discipline |
| 10 | `docs/PERF.md` re-taken numbers | **partly done** | the inflation figures are in §2.5 already; bundle size and RSS are still owed (macOS) |
| 11 | `AGENTS.md` gains a P58 findings entry; the sections whose subject this phase removes are rewritten | **P58f** | see below |
| 12 | `docs/ARCHITECTURE.md` updated per §3, **including the rewritten bulk-data invariant (D3)**, the rewritten "Why a separate engine process", the SQLite `caps.cancel` sentence and the Kafka capability recovery; SPEC.md's P58 row | **P58f** | **D17**, **D16**. Note the bulk-data invariant is the one item D3 required *in the same commit as the code* and that never landed (§1.13 item 1) |

**Criterion 12, in grep form** (P58d OQ-2's lesson, and the form P58d/P58e both used):

```
grep -n "vendored Node\|build:engine\|src/engine\|stdio\|engine child\|mattn/go-sqlite3" docs/ARCHITECTURE.md
```
returns nothing outside the Testing section's historical notes; and

```
grep -n "Bulk data passes through the Go process" docs/ARCHITECTURE.md
```
returns nothing (D3's replacement is what stands).

**Criterion 11's own list**, for the `AGENTS.md` entry — things a future session would otherwise
re-derive:

- **Deleting a directory is the easy half; finding its type dependencies is the hard half.**
  `enginehost` was named as "the sidecar's supervisor" by every plan, but three of its four Go
  consumers used it for the op-log `Event` type and one backpressure sentinel, not for the child at
  all (§1.8).
- **A coexistence-window mitigation that covers the pull path and not the push path leaves a
  silently-wrong number in the UI for five sub-phases** (§1.7 / **D12**) — the same failure class as
  P57's `byteSize: 0`, found the same way: by asking what actually produces the value.
- **A generated fixture outlives the code that generated it, and a mocked frontend spec will keep
  asserting a dead adapter's behaviour indefinitely** — `kafka.frontend.spec.ts` asserted an empty
  Configuration section for three weeks after the Go adapter started returning 32 rows (§1.5). The
  anti-drift guarantee holds only while *something* regenerates.
- **Go's `encoding/json` escapes HTML by default and sorts map keys**; a generator writing
  TypeScript needs `SetEscapeHTML(false)` and structs, never maps (§4.3c).
- **The Go test suite has no Node dependency left** — `enginetest`'s `engine-fixture.mjs` was the
  last one (§5.4).
- **The product's own Go code is cgo-free** (`modernc.org/sqlite` for both the adapter and app
  storage); only Wails' own macOS bindings still need `CGO_ENABLED=1`. `AGENTS.md`'s own
  `mattn/go-sqlite3` claims at `:205` and `:238` were stale before this phase started.
- **Both `tests/db/` and `tests/ipc/` survive P58 as something other than what they were**: the
  first as a shared fixture corpus two other tiers read; the second with a Go backend half.
- The three items **P58f D7**, **D5** and D11's last paragraph carry past P58: the untested `E_AUTH`
  branches (sqs, s3, kafka), the Kafka group `type` row, and `src/shared/protocol/ipc.ts`'s dead
  `KiraApi`/`AppInfo` interfaces.

### 7.1 Manual checks this sub-phase owes

Recorded **including "not available in this session"**, per the parent's §6.

| Check | Why | Pass looks like |
|---|---|---|
| **The app boots with no child process** (Linux, `-tags server`) | commit 11 is the first build that never calls `enginehost.Start` | the window renders; `pgrep -P <serverPid>` is **empty**; the status pill reads `ok` with the app's own pid |
| **The cache readout moves** (**D12**) | `tests/ui/`'s mock has no `Events.On` analogue, so no tier can see this | open a table, page it, watch the status bar's cache size leave zero and the settings dialog's hit rate become non-zero |
| **Bundle size and cold start with no vendored Node** | properties of a real `.app` | new numbers in `docs/PERF.md` §3 and the L-D lever row |
| **Total RSS** | the V8-isolate saving separated from drivers-now-in-process | a recorded number |
| **`sign-bundle.sh` with no nested executable** | the bundle layout `create:app:bundle` now produces | every `codesign` line succeeds; `--verify --deep --strict` exits 0 |
| **`verify-packaging.sh` against a real bundle** | A2/A4/N1 removed rather than skipped | exits 0 |
| **A real S3 download through the AppKit save panel** | server mode has no file dialogs (P58d OQ-5, structural) | an object downloads to a chosen path |
| **A Kafka connection in a packaged build** | the parent's §6 names this as the milestone; **P58e explicitly did not claim it** | connect, browse a topic, produce a message — the first time this has ever been verifiable in a packaged bundle |

---

## 8. What the parent plan gets wrong, named

Every sub-phase plan before this one ended by naming what its parent got wrong rather than working
around it. In order of how much trouble each would cause an M10 implementer who trusted it:

1. **§3's `tests/db/ DELETED` is wrong.** Five `.sql` fixtures are read by Go at runtime and five
   `support/*.ts` modules are re-exported by `tests/e2e-real/` (§1.3). A directory-level delete
   breaks every Go adapter suite and the whole `e2e-real` tier.
2. **§8 criterion 5 is unachievable.** The committed `tests/ipc/` fixtures encode behaviour the Go
   adapters deliberately changed, and one frontend spec already asserts something false about the
   shipping app (§1.5). **D13** amends it.
3. **§7's "`src/` changes, enumerated" contradicts §7 item 3** — the settings control cannot both be
   removed and be outside the diff (§1.15). **D18** resolves it; the diff is three files.
4. **D14 names the wrong surface.** The status pill reads the data-plane `ping`, not
   `EngineService.Status()`, which has zero renderer callers (§1.9). Following D14 literally would
   ship a permanently-`down` pill. **D11** resolves it.
5. **§1.12 and §3 miss five real deletion targets**: `internal/enginebackend/` (created after the
   parent was written), `shell/build/darwin/Taskfile.yml`'s runtime guard (which would abort every
   package build), `biome.json`'s two `src/engine/adapters/**` overrides, the two `scripts/capture-*.ts`
   dev tools, and `tests/unit/catalog-listing.spec.ts` (§1.11, §1.12).
6. **§1.2 and §8 criterion 12 ask for an edit `docs/v1/README.md` forbids**, and the parent's own
   amendment note says the opposite in the same document (§1.13, **D16**).
7. **D3's rewritten bulk-data invariant never landed**, so `docs/ARCHITECTURE.md` has carried two
   contradictory statements of the same rule since P58a M4 (§1.13 item 1). The decision was right;
   the "same commit as the code" clause did not hold, which is an argument for grep-shaped criteria
   over prose ones — the exact lesson P58d already drew.
8. **D6's SQLite and ClickHouse rows and D8's first part are superseded by implementation.**
   `modernc.org/sqlite` for both SQLite consumers (P58b OQ-1), a hand-rolled `net/http` client for
   ClickHouse (P58b OQ-2). D8's *capability* claim held — `caps.cancel` is `true`
   (`internal/adapters/sqlite/caps.go`) — but via a different driver and a different mechanism, and
   `docs/ARCHITECTURE.md:45` still names the driver that lost (§1.13 item 2).
9. **§1.1's counts, §1.11's "seven adapters", §1.8's RabbitMQ row and §1.12's line figures are all
   stale by exactly one dropped kind plus five sub-phases** (§1.1, §1.4). Harmless if noticed,
   misleading if quoted.
10. **§5.5's proposed `tests/e2e-real/` S3-download spec cannot be built** — Wails v3.0.0-beta.15's
    `serverSaveFileDialog.show()` returns *"file dialogs not available in server mode"*, so the tier
    this repo uses instead of a GUI can never reach the contract (P58d OQ-5). M11 strikes it so
    nobody re-proposes it as outstanding.
11. **§0.2's last bullet is now two phases stale.** It says `.github/workflows/` is stale from P57
    M7 and *"P58 makes them more stale"*; both are true, and the staged replacement in
    `docs/v1/plans/p57-pending-ci-workflows/` is itself now stale for P58 (§1.14), so what is
    pending is a P58-current revision, not P57's.

---

## 9. Environment notes for the implementing session

- **`./internal/...` needs nothing but the Go toolchain.** With `mattn/go-sqlite3` gone there is no
  cgo in the product's own Go code at all; only the root `main` package needs
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`. The fast loops for M10 are
  `go test ./internal/adapterhost/... ./internal/connections/... ./internal/tree/... ./internal/oplog/...`
  (commits 5–11, no Docker) and `go test ./internal/ipcfixture/ -run TestFixture_<Adapter>`
  (commits 12–14, Docker, one container).
- **`shell/runtime/` is git-ignored, and until commit 11 the app still refuses to start without both
  halves** (`resolveEngine`'s `log.Fatalf`, P56 D12). So `scripts/wails-dev-setup.sh` +
  `bun run build:engine` are still prerequisites for commits 1–10's manual checks and become
  unnecessary at 11 — which is the single most visible ergonomic win of this sub-phase and worth
  noting in that commit's message.
- **Docker images for commits 12–14**: `mariadb:11.4`, `mysql:8.4`,
  `clickhouse/clickhouse-server:26.3`, `redis:7`, `localstack/localstack:3`,
  `confluentinc/cp-kafka:8.0.7` — all mirror-pulled and retagged per `AGENTS.md`'s Docker section
  (`library/` for the unnamespaced ones, none for the rest). Kafka needs
  `kafka.WithClusterID(...)` and `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` (P58e M9.0 KF-4(a)/(d)) —
  `testsupport/kafka.go` already does both.
- **`bun run test:ui` and `bun run test:ipc:fe` need WebKit and Chromium.** `bunx playwright install
  webkit` plus `libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav`, and
  `bunx playwright install chromium` for `chrome-headless-shell`. P57's finding stands: a blocked
  download host is worth retrying each session, not a permanent wall.
- **`shell/frontend/bindings` is git-ignored** and must be regenerated
  (`wails3 generate bindings -b -i -ts -names`, `wails3` **pinned** to `shell/go.mod`'s
  `v3.0.0-beta.15`, never `@latest`). P58f changes two bound signatures (`AppInfo.Node` removed,
  `SettingsPatch`'s advanced field), so regenerate after commits 7 and 8 as well as in any fresh
  container.
- **A background process started in one shell invocation cannot be signalled from a later one.**
  Commit 11's boot check and commit 17's `tests/e2e-real/` sweep are **one** Bash invocation each,
  150 s+ timeout, polling a log file rather than sleeping.
- **`tests/e2e-real/` must be re-run in full after commits 4, 9, 11 and 19**, not only at the end.
  P58b's finding is the reason: two real wire-path regressions (the missing base64 branch, Go's
  `null` for a nil slice) were invisible to every mocked tier and were caught only by driving the
  real built app. Commit 4 changes the wire encoding; 9 and 11 change the routing; 19 changes the
  build.
- **Comparing a struct with an `any` field using `==` panics at runtime.**
  `model.ConnectionState.Caps` is one; use `go-cmp`. Relevant to the rewritten
  `connections/service_test.go`.
- **`bunx biome check --write` runs over every generated `*.fixture.ts` before committing**, and
  `bun run lint` is not a substitute for having done it.

---

## 10. Open questions for whoever comes after

Not for this plan's author — for P58g's and P59's.

**OQ-1 — `src/shared/protocol/ipc.ts`'s `KiraApi` and `AppInfo` are dead and P58f deliberately did
not touch them.** They are pre-Wails `contextBridge` leftovers that `docs/v1/SPEC.md`'s P52–P57 row
names as still open going into P58/P59. They live in D1's protected surface, they predate this phase,
and a dead-interface audit is P59's architecture round, not a deletion sub-phase's. Named here so the
next reader finds one item rather than a grep result.

**OQ-2 — after P58f, `src/` contains exactly two things: the renderer and `shared/`.** Whether
`src/shared/` still earns being a separate top-level directory when its only consumers are
`src/renderer/**` and a handful of test-support modules, and whether `src/renderer` should simply be
the frontend root, are **P58g** questions. P58f deliberately leaves the shape alone (§0.3) so that
phase gets a clean tree to move rather than a moving one to delete from.

**OQ-3 — the op-log event channel could become typed direct calls, and P58f decided not to
(D9).** The reason is a specific, hand-audited mutex-free invariant in `oplog/wire.go:89`, not
inertia. P59's performance round is the right place to re-price one `json.Marshal`/`Unmarshal` per
op-log row against the mutex it would cost.

**OQ-4 — the `E_AUTH` gap (D7) now spans three adapters and is the largest remaining
untested-branch cluster in the adapter layer.** The cheapest honest vehicles are a LocalStack
`ENFORCE_IAM=1` variant and a SASL/PLAIN `cp-kafka` variant, one scenario each. Scoped work, not a
sub-phase's absorbed cost.

**OQ-5 — `.github/workflows/` has now been pending across three phases.** After M11 the staged
directory (if that is where it lands) will be named for P57 and contain P58-current files. Whoever
finally has a `workflow`-scoped push should land them and delete the directory in the same commit;
its continued existence is the signal, and a signal that has been on for three phases stops being
read.

---

### Critical files for implementation

- `/home/user/kira-studio/shell/internal/adapterhost/router.go` — the child half is ~190 of its 462 lines: `child`, the seven `*ViaChild` methods, `nativeKinds`/`native`/`isNative`/`IsNativeKind`, `NewRouterAllNodeServed`, and checkpoint C2's `noteChildRoute`/`ChildRoutes` counter, whose own comment already says P58f deletes it.
- `/home/user/kira-studio/shell/internal/adapterhost/dataframe.go` — where `ping` stops forwarding and starts being answered (**D11**), where `observeChildEvent`/`mergedCacheStats` delete, and where the Go cache's `cache:stats` push must be wired in (**D12**); `AttachStream` at `:31-45` is the subscription's home.
- `/home/user/kira-studio/tests/ipc/support/harness.ts` and `/home/user/kira-studio/tests/ipc/support/types.ts` — the first is the 185-line subject the Go generator replaces (including the P57 D15 Map-backed tree stand-in the real `tree.Service` supersedes); the second is the snapshot schema the Go writer must emit against, and it **survives** (24 `tests/ui/` files import it).
- `/home/user/kira-studio/tests/ipc/kafka/kafka.fixture.ts` — the concrete proof that the parent's §8 criterion 5 cannot hold: line 151's "no DescribeConfigs call" note and line 195's `"type": "CLASSIC"` / `"partitionAssignor": ""` are both behaviour the Go adapter changed (P58e E11/E13), and `kafka.frontend.spec.ts:127`'s `toHaveCount(0)` is the assertion that breaks.
- `/home/user/kira-studio/tests/ui/support/mockStreamBrowser.js` — `encodeChunk` at `:62-85` and the `JSON.stringify(frame)` at `:243` are the only producer of the index-keyed chunk encoding left in the repo; it must switch to base64 in the same commit `src/renderer/bridge/port.ts:91` loses its `Object.values` branch, and its real-`byteSize` computation at `:95-110` must not regress.
- `/home/user/kira-studio/shell/build/darwin/Taskfile.yml` — lines 170-180 hard-fail `create:app:bundle` unless `runtime/{node,engine}` exist and then copy them into the bundle; no P58 plan document has ever named this file, and leaving it aborts every package build after M10.
