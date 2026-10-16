# P168 Part 4: review plan, Studio DB adapters II (document, key-value, stream, object-store)

Chunk A3, Stream A position 3 (pre-plan `P168-prep-plan.md` §5.3). One Opus reviewer runs this
plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `1a613e6` (`p168-stream-a`, rebased onto `v2.0`; Part 2 and Part 3 fixed, Part 3
findings file dropped). `v2.0` tip is the same commit.

Paths repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`. Line numbers are
as of `1a613e6`; re-read before citing.

SPEC row names this file `P168-part4-adapters-nosql.md`; the orchestrator named it
`P168-part4-nosql-adapters.md`. Same plan, this name wins (Part 3 precedent).

## 0. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamA` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index: run
  `sh scripts/codegraph-setup.sh` if `.codegraph/` is missing. If it reports the DB locked by the
  MCP server's own process, the server's watcher keeps it synced; carry on. Seeds per engine:
  - mongo: `Adapter.Connect`/`Disconnect`/`Cancel`/`trackerFor`, `Connect` (`client.go`),
    `buildURIFromFields`, `tlsConfigForSslmode`, `parseStatement`, `isAggregateWrite`,
    `isWriteStatement`, `ClassifyStatement`, `statementRunners`, `runCursorOp`,
    `ParseDocumentLiteral`, `ParseFilterObject`, `ResolveEJSONWrappers`, `tokenize`,
    `buildFindOptions`/`keysetIDCondition`/`bsonSortTiers`, `buildReadPage`, `countRows`,
    `mutateDB`, `parseIdKey`.
  - redis: `connectRedis`, `dbConnectionSet` `dial`/`get`/`isReadOnlyCommand`/`closeAll`,
    `resolveFields`, `ClassifyStatement`, `tokenize`/`scanQuotedToken`,
    `rejectConnectionStateCommand`, `execute`, `resultToPage`, `scanRound`, `escapeGlobPrefix`,
    `scanFamilyRound`, `readString`/`readList`/`readStream`, `countKey`, `KeyTypes`, `mutateDB`.
  - kafka: `connect`, `resolveTLSOpt`, `readTopic`, `prepareWindows`, `freshWindows`,
    `resolveStartOffsets`, `openBrowseClient`, `pollRound`, `advanceWindows`,
    `clampExhaustedWindows`, `buildStreamRow`, `countTopic`, `produce`, `listGroups`,
    `buildGroupDefinition`.
  - sqs: `connect`, `Adapter.Disconnect`, `resolveQueueURLCached`, `listQueues`, `pollQueue`,
    `receiptHandles` `set`/`forDelete`, `fetchVisibilityTimeout`, `mutateQueue`,
    `resolveFIFOInsertFields`.
  - s3: `connect`, `listBuckets`, `listPrefixChildren`, `resolveObjectTarget`, `readObject`,
    `countObject`, `downloadObject`, `openUploadBody`, `applyInsert`/`applyUpdate`/
    `applyDelete`, `applyPreservedAttributes`.
  - awscfg: `Resolve`, `MapError`, `mapConfigError`.
  - core and callers: `RunWithAbortRace`, `QueryTracker` (`TrackerFor`/`Snapshot`/`Drain`/
    `PopRunningWith`), `ConnGuard`, `ConnSet` (`Get`/`Drop`/`CloseAll`), `Router.Connect`/
    `Disconnect`/`ClassifyStatement`, `Host.CancelOp`, `Dispatcher` download path,
    `connections.Service.abortInFlight`.
- **CodeGraph over-links names.** Every engine has `Connect`/`Disconnect`/`Cancel`/`mapError`/
  `applyUpdate`; queries return the SQL engines' copies first. Confirm every cross-package claim
  with `git grep` of import lines (Go's `internal/` rule makes those authoritative).
- **Driver source in the module cache** where a claim turns on driver behavior (`go.mod`):
  `go.mongodb.org/mongo-driver/v2@v2.9.1` (lazy `Connect`, `Client.Disconnect` with a live op,
  comment propagation to `getMore`, `bson.UnmarshalExtJSON`), `redis/go-redis/v9@v9.22.0`
  (`Do` with ctx: does a cancelled ctx interrupt a blocked read, `ContextTimeoutEnabled`,
  `Command` reply shape, pool `Close` with an in-flight command), `twmb/franz-go@v1.21.6` and
  `pkg/kadm@v1.18.0` (`PollRecords` with ctx, `ConsumePartitions`, `ListOffsetsAfterMilli`,
  `Close`, SASL), `aws-sdk-go-v2/service/sqs@v1.52.0` (`ReceiveMessage`, `DeleteMessage`),
  `service/s3@v1.113.1` (`ListObjectsV2`, `GetObject` body, `PutObject` checksum/seek,
  `IfMatch`/`IfNoneMatch`), `aws-sdk-go-v2/config@v1.33.4` (credential chain, IMDS probe,
  profile load), `smithy-go@v1.28.1` (error text).
- **Scratch probes** in the session scratchpad or a throwaway `_test.go` deleted before the
  findings commit, never committed, where a claim turns on runtime behavior (literal parser
  output on a crafted statement, redis tokenizer, kafka window arithmetic on a crafted token).
- **Checks:** `go vet ./apps/kira-studio/internal/adapters/...` and
  `go test -race ./apps/kira-studio/internal/adapters/{mongo,redis,kafka,sqs,s3,awscfg}/...`.
  **Docker daemon is up in this container** at plan time (`docker info` succeeds). If it is down,
  start it per `docs/DEV_ENVIRONMENT.md` Docker section (`dockerd`, pulls via `mirror.gcr.io`,
  `TESTCONTAINERS_RYUK_DISABLED=true`). Run the real suites: mongo, redis, kafka (plain and
  SASL), localstack for sqs and s3 (`testsupport/{mongo,redis,kafka,kafka_sasl,localstack,sqs,
  s3}.go`). Without Docker the container suites skip (`testsupport.DockerUnavailableMessage`);
  the internal unit tests still run. The permutation matrix stays gated (`KIRA_TEST_MATRIX=1`,
  `scripts/test-matrix.sh`); not required. If missing deps or bindings fail a check:
  `bun install --frozen-lockfile` and `bun run setup` (or `sh scripts/prepare-worktree.sh`). A
  red check is a finding.
- **Lifecycle probes.** `testsupport.StartPausableProxy` (Part 3) is a generic TCP forwarder
  keyed on `cfg.Host`/`cfg.Port`: usable as-is for mongo, redis and kafka probes (kafka needs the
  advertised listener to match, check before trusting a result). sqs/s3 dial an `endpoint`
  option, not host/port; a probe there needs the proxy pointed at the localstack port and the
  endpoint option rewritten.

## 1. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `1a613e6`. **Part 4: no drift.** 72 files, 15,798 code lines,
7,277 test lines, same as `f40cd35`. No Part 4 file changed since the pre-plan
(`git log 743af03..HEAD` over the six dirs shows only the history root `cbdc489`).

Drift elsewhere, none touching a Part 4 file:
- Part 2: 145 to 148 files, 19,684 to 20,159 lines (tests 7,872 to 8,088).
- Part 3: 138 to 142 files, 26,401 to 27,722 lines (tests 8,115 to 8,677): `connguard.go`,
  `connguard_test.go`, `testsupport/lifecycle.go`, `testsupport/proxy.go` added by its fixes.
- Part 8: 16,274 to 16,328. Part 16: 18,789 to 18,792. Part 20: 20,140 to 20,312 (tests 4,585
  to 4,590). Part 21: 17,275 to 17,327.
- Totals: streams A 255,934, B 182,321; 2,875 owned, 0 orphans, 3,503 tracked (docs 475).
- **Stream drift, not caught by the script:** SPEC `8a008bd` moved Parts 10-13 to a new Stream C
  (3 streams). The script still labels every Part up to 13 `[A]`. For this chunk it changes edit
  scope (§8): Parts 10-13 files are no longer Stream A's.

P166-scope churn in Part 4: 0 lines (pre-plan §4). Review the whole chunk, not a diff.

## 2. Own file set (72 files)

45 production `.go` (8,521 lines), 27 `_test.go` (7,277). Per package:

- **`SA/mongo`** (10 prod, 2,830; 7 test, 2,047): `adapter` 406, `caps`, `catalog`, `client`
  152, `console` 527, `definition`, `errors`, `literal` 686, `mutate` 192, `read` 563. Tests:
  `mongo_test` 1,079 (conformance), `authmatrix_test`, `client_test`, `literal_test` 408,
  `read_internal_test`, `read_missingid_internal_test`, `read_bench_test`.
- **`SA/redis`** (8 prod, 1,925; 7 test, 1,707): `adapter` 318, `caps`, `catalog` 271, `client`
  225, `console` 395, `errors`, `mutate` 185, `read` 442. Tests: `redis_test` 814,
  `authmatrix_test`, `catalog_test`, `client_test`, `connset_wiring_test`, `console_test`,
  `mutate_path_test`.
- **`SA/kafka`** (9 prod, 1,576; 5 test, 1,542): `adapter` 256, `caps`, `catalog`, `client` 168,
  `definition` 223, `errors`, `kafka` (doc), `produce` 108, `read` 598. Tests: `kafka_test`
  1,143, `authmatrix_test`, `client_test`, `main_test`, `read_test`.
- **`SA/sqs`** (8 prod, 943; 4 test, 852): `adapter` 261, `caps`, `catalog`, `client`,
  `definition`, `errors`, `mutate` 171, `read` 288. Tests: `sqs_test` 533, `authmatrix_test`,
  `mutate_internal_test`, `read_internal_test`.
- **`SA/s3`** (8 prod, 1,088; 4 test, 1,129): `adapter` 235, `caps`, `catalog` 131, `client`,
  `errors`, `mutate` 328, `read` 185, `transfer` 117. Tests: `s3_test` 819, `authmatrix_test`,
  `catalog_test`, `mutate_path_test`.
- **`SA/awscfg`** (2 prod, 159; no test): `config` (`Resolve`), `errors` (`MapError`). Shared by
  sqs and s3 only.

## 3. One hop: callers (git grep of import lines, production files)

- **Engine packages are reached only through the registry.** `main.go` blank-imports mongo,
  redis, kafka, s3, sqs for `init()` `adapters.Register`. `awscfg` is imported by `sqs` and `s3`
  only. Test-only importers: `ipcfixture/{kafka,redis,sqs}_test.go` (Part 5). `layering_test.go`
  (Part 6) names `adapters/kafka` only in a comment.
- **`adapterhost`** (Part 5): `Router.Connect` (cancels ops for the id, takes the old adapter for
  teardown, `CreateAdapter`, `adapter.Connect` inside `RunOp`; on error disconnects the fresh
  adapter), `Router.Disconnect` (`CancelOpsForConnection`, `takeLiveAdapterForTeardown`,
  `disconnectAdapter` bound), `Router.ClassifyStatement` (`router.go:395`, mongo and redis
  implement `StatementClassifier`; kafka/sqs/s3 fall back to `ClassUnknown`),
  `Router` `KeyTypes` (`router.go:365`, redis only), `Host.CancelOp` (`host.go:317`: local ctx
  cancel first, then `adapter.Cancel`), `data.go:188` `DownloadObject` (s3 only).
- **`dbmcp`** (Part 6): `tools.go:295` `run_query` and `explain.go:118` classify through
  `Router.ClassifyStatement` before `Execute`. For mongo and redis the classifier is the
  agent-side security gate.
- **`connections`** (Part 2, closed): no `SA` import; reaches engines through
  `connections.Backend` (`adapterhost.Router`). Part 2's `abortInFlight` waits unbounded on an
  in-flight `Backend.Connect` (Disconnect, Remove, Update), so each engine's `Connect` must return
  promptly on ctx cancel (§5.1).
- **`bridge`** (Part 6): `ops.go:49` `Canceller.Cancel` with `context.Background()`;
  `tree.go:69` `KeyTypes`. No direct engine import.
- **Frontend, read only for mirrors and reachability** (Stream C, Parts 12-13):
  `shared/caps.ts` (Part 13) mirrors `SA/caps.go`; `shared/domain/streamFilter.ts` (Part 12)
  mirrors `kafka/read.go` `kafkaStreamFilter`; `shared/domain/object-store.ts` (Part 5) mirrors
  the s3 transfer shapes; `views/{documents,keyvalue,stream,browse}` (Part 12) consume the pages.

## 4. One hop: callees

- **`SA` core** (Part 3, closed). Symbols used, counted by `git grep` per engine:
  - all: `New`/codes, `OpCtx`, `TreeChildren`, `CountResult`, `Unsupported`, `ConnectInfo`,
    `Guarded` (P113 G1 handle state), `RequireConnected`, `Register`, `Deps`, `Caps`.
  - mongo: `RunWithAbortRace` (12 sites in `read.go`/`mutate.go`/`console.go`), `QueryTracker`
    (only Part 4 user), `EncodePageToken`/`DecodePageToken`/`RequestFingerprint`,
    `PaginationCursor`, `ParseSSLMode`, `DispatchUpdateDeleteInsert`, `RunKindDispatched`,
    `AssertWritable`, `JoinConsoleStatements`, `SafeInt`, `StatementClassifier`.
  - redis: `ConnSet`/`NewConnSet`/`ConnSetOptions` (only Part 4 user), `ClassifyNetError`,
    `ParseSSLMode`/`SkipsVerification`, `ValueFrom`, `AbbreviateCount`, `RequirePathPrefix`,
    page tokens, `AssertWritable`, `StatementClassifier`.
  - kafka: `CheckNotStarted`, `CheckCancelled`, `PreviewProduce`, `ParseHeaderJSON`,
    `PaginationOffsetWindow`, page tokens, `NoQueryConsole`, `ParseSSLMode`/`SkipsVerification`,
    `ClassifyNetError`, `AssertWritable`.
  - sqs: `PreviewProduce`, `ParseHeaderJSON`, `PaginationBatch`, `RunKindDispatched`,
    `NoQueryConsole`, `AssertWritable`. s3: `RequirePathPrefix`, `PaginationToken`, `ValueFrom`,
    `DispatchUpdateDeleteInsert`, `CheckNotStarted`. awscfg: `ClassifyNetError`.
  - **Not used by Part 4:** `ConnGuard`, `PopRunningWith`, `ConnSet.Drop`, `SQLDialect`,
    `ClassifySQL`/`StripSQLComments`/`AssertNoHiddenStatement`, `KeysetForwardIDs`,
    `ConnectionLifecycleScenarios`. Part 3's signature changes (`ClassifySQL(stmt, d)`,
    `BuildKeysetWhereSQL(..., isBinary)`) touched no Part 4 caller; the tree builds.
- `SI/storage/model` (Part 2, closed): `ResolvedConnectionConfig` (`URI`, `Options`, secrets),
  `NodePath`, `MutationPlan`/`MutationRowOp`/`RowValues`, `ObjectDownloadRequest`,
  `MongoConsoleMethods`, `ConsoleRequest`.
- `SI/page` (Part 5, later): `DocumentPageBuilder`, `KeyValuePageBuilder`, `StreamPageBuilder`,
  `TabularPage`, `ObjectUploadMaxBytes` (`chunk.go:20`, 5 GiB).
- `internal/jsonx` (Part 8): `redis/read.go` only.
- `SA/testsupport` (Part 3, closed): per-engine container starters and `matrix.go`/`spec.go`
  helpers used by the Part 4 suites.
- SDK clients as in §0.

## 5. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk turns
user and agent text into Mongo filters and commands, Redis commands, S3 keys and SQS/Kafka
operations, and enforces read-only for each.

### 5.1 Lifecycle, cancellation and tracker (Part 3 analogues, per engine)

Part 3 found, for the pinned-connection SQL engines: a cancelled op killing the connection for
good (F5), a queued op not cancellable and teardown blocking on a hung op (F6), a server-side
cancel landing on the next op (F7), `inFlight.Add` with no draining guard (F8), `Connect`
ignoring ctx (F9). Check each Part 4 engine for the same class, with its own mechanism:

- **mongo** (`adapter.go`). `Cancel` (`:373`) never consults the tracker: it runs `$currentOp`
  filtered on `command.comment == opID`, then `killOp`. Weigh: a Stop issued before the command
  reaches the server (`$currentOp` empty, returns false) leaves the op running on
  `RunWithAbortRace`'s detached ctx with **no deadline at all**; `getMore` batches of a `find`
  cursor (grid `readPage` `read.go:325`, console `runCursorOp` `console.go:242`) and whether
  they carry the comment; a cursor left open on abort. `Disconnect` (`:135`): `Snapshot` then `Cancel` each (one `$currentOp` per op, on
  Router's bounded ctx), `Drain(ctx)`, then `client.Disconnect` with `disconnectTimeout` while a
  goroutine may still run if `Drain` timed out. `TrackerFor` during `draining` returns a no-op
  release: an op started in that window runs untracked. `Connect` (`:108`) sets state only after
  `buildInfo` succeeds; the driver's `Connect` is lazy and the probe takes ctx: confirm prompt
  return on ctx cancel against `connectTimeout`/server selection (10 s). Catalog calls
  (`listDatabases`, `listCollections`, `Describe`, `Definition`) take the op ctx directly, not
  `RunWithAbortRace`: cancel semantics differ by method; check none hangs past Stop.
- **redis.** `Cancel` (`:316`) is a permanent no-op by design (C9). Weigh what Stop does to a
  blocking or long console command (`BLPOP k 0`, `XREAD BLOCK 0`, `WAIT`, `DEBUG SLEEP`, `KEYS *`
  on a large db, `EVAL` with a long loop): does go-redis `Do(ctx)` return on ctx cancel, and if
  it does, is the pooled connection then poisoned (late reply read by the next command) or
  discarded? `Disconnect` (`:87`) closes the `ConnSet` with no tracker: an in-flight op's client
  closes under it (expect `ErrClosed`, check the mapped code). `ConnSet` per db index:
  single-flight dial, LRU eviction closing a `*goredis.Client` another op just got from `Get`
  and is mid-command on (`Close` func is unconditional), `Max` 8, Primary never evicted, dial
  after `CloseAll`. A dead connection: go-redis redials inside its pool, so Part 3's `Drop` is
  likely unneeded; confirm. `Connect` (`:55`): `connectRedis` already dials primary, then
  `set.primary(ctx)` again; `INFO` failure tolerated. Dial takes ctx with `DialTimeout` 10 s.
- **kafka.** `Cancel` (`:254`) no-op; every kgo/kadm call takes the op ctx. `readTopic`
  (`read.go:477`) opens an ephemeral browse client per page (`openBrowseClient` `:332`), closed
  by `defer`; `pollRound` (`:365`) bounds each round at `pollTimeout` 1 s, `maxEmptyPolls` 2.
  Weigh: browse client creation cost and goroutine/socket leak per page under rapid paging; a
  browse client still polling when `Disconnect` closes the main client (it shares
  `baseOpts`, not the client); `ErrClientClosed` treated as a clean stop (a truncated page
  reported as complete?); `Connect` `Ping(ctx)` promptness, the anonymous-then-SASL heuristic.
- **sqs/s3.** `Cancel` no-op; op ctx passed to every SDK call (P58d D3). `Disconnect` only clears
  state (no sockets to close): an op past `requireClient` keeps using the client after Disconnect
  (benign? confirm, and that sqs `cacheQueueURL` after Disconnect stays a no-op). sqs
  `receiptHandles` cleared on Disconnect while a `Mutate` holds a handle. s3 upload/download:
  ctx cancel mid-`io.Copy`, temp file removed on every path, upload body file closed.
  `awscfg.Resolve` `LoadDefaultConfig(ctx)`: does the default chain do network I/O at load
  (IMDS region/credential probe, SSO) and is it bounded when ctx has no deadline?
- **All engines:** Part 2's `abortInFlight` waits unbounded on `Connect`; any `Connect` that
  ignores ctx stalls Disconnect/Remove/Update in the UI. Reconnect on the same id builds a fresh
  adapter (`Router.Connect` `CreateAdapter`), so per-instance state reuse after Disconnect only
  matters inside one instance. A `Connect` failing after it opened something must close it
  (mongo probe failure calls `handle.Client.Disconnect(context.Background())`: unbounded?).

### 5.2 Read-only enforcement and injection

- **mongo console** (`console.go`). `parseStatement` (`:99`) grammar `db.<coll>.<method>(args)`
  over `model.MongoConsoleMethods`. `isAggregateWrite` (`:52`) flags `$out`/`$merge` only as a
  top-level key of a stage in `args[0]` when it is a `bson.A`: check a pipeline given in any other
  shape that the driver still accepts, a stage key with different case or whitespace the server
  normalises, an options argument (`args[1]`) the runner forwards, and whether any other runner
  path (`countDocuments` with a pipeline-like filter, `find` with `$where`/`$function`) can write.
  Server-side JS (`$where`, `$function`, `$accumulator`) in a read-only connection or through
  `run_query` classified `read`: no write possible, but weigh unbounded CPU. Collection names the
  grammar admits (`ExpectIdent`: ASCII ident only) versus real names with `.`/`-`/unicode: a
  collection unreachable from the console is a functional bug. `ClassifyStatement` returns
  `ClassUnknown` with an error on parse failure: confirm dbmcp treats that as deny.
- **mongo literal parser** (`literal.go`). `tokenize`/`ParseValue`: number scanning
  (`isNumberRune` admits `1e5e5`, `1-2`, `--1`), int64/float overflow, `NumberLong`/`NumberInt`/
  `NumberDecimal`/`ObjectId`/`ISODate`/`Timestamp`/`BinData`/`UUID` constructors and their argument
  validation, duplicate keys, deep nesting (stack), unterminated input, `\u` escapes and
  surrogates, `ResolveEJSONWrappers` turning a user value into an operator or type silently
  (`{$numberLong: "x"}` falls through as a plain doc; `{$regex}`/`{$code}` wrappers).
- **mongo grid paths** (`read.go`, `mutate.go`). Filter text through `ParseFilterObject`; sort
  terms become `bson.E{Key: t.Column}` (`read.go:140-147`): a column starting with `$` or holding
  `.`; `_id` from the key path via `parseIdKey`: an `_id` text that parses as an operator
  document matching many rows (update/delete guarded by `MatchedCount`/`DeletedCount != 1`, but
  after the write). `applyUpdate` is a whole-document `ReplaceOne`: concurrent edit lost update.
- **redis console** (`console.go`). Read-only and classification both rest on
  `isReadOnlyCommand` (`client.go:195`): top-level `COMMAND` flags by name only. Weigh container
  commands whose top-level entry and subcommands differ (`OBJECT`, `XINFO`, `MEMORY`, `CLIENT`,
  `CONFIG`, `SCRIPT`, `FUNCTION`, `CLUSTER`, `PUBSUB`), renamed commands (`rename-command`),
  module commands, `EVAL_RO`/`FCALL_RO`/`SORT_RO` vs `SORT ... STORE`/`GEORADIUS ... STORE`,
  server versions whose `COMMAND` lacks a flag, the cache filled once per set (an ACL change or
  failover to another server), and `COMMAND` failing (fail closed, not cached; retried every
  call). `rejectConnectionStateCommand` (`:305`) denylist against go-redis pool state: check
  `CLIENT TRACKING`, `CLIENT NO-EVICT`/`NO-TOUCH`, `READONLY`/`READWRITE`, `ASKING`, `SWAPDB`,
  `FLUSHALL ASYNC`, `SHUTDOWN`, `REPLICAOF`, `SAVE`/`BGSAVE`, `DEBUG`, `MIGRATE`, `OBJECT
  FREQ`, `CLIENT SETNAME`, `CLIENT KILL` on itself: which corrupt shared pool state or the
  connection (not merely write). `tokenize`: one line is one command; confirm no input yields two
  commands on the wire. Reply size: `KEYS *`, `HGETALL`/`LRANGE 0 -1`/`SMEMBERS` on a huge key go
  straight into `resultToPage` with no cap (memory, page size).
- **redis grid paths.** `scanRound`/`escapeGlobPrefix` (`catalog.go`): glob metacharacters and
  binary bytes in a key prefix, keys containing the namespace separator, keys not valid UTF-8 in
  `NodePath` JSON. `scanFamilyRound`/`readStream`: cursor boundaries, `pageSize+1` probe,
  `XRANGE` exclusive start, `MEMORY USAGE` fallback. `dbIndexFromName`: out-of-range index,
  cluster mode (only db 0), sentinel/cluster URIs refused or silently mis-dialled.
  `assertEditableType` then `SET KEEPTTL`: TOCTOU across type change; `SETNX` insert.
- **kafka.** Read-only browse must never join a consumer group or commit offsets
  (`ConsumePartitions`, no group; verify no `kgo.ConsumerGroup`/`CommitOffsets` reachable,
  including `buildGroupDefinition`'s `DescribeGroups`/`FetchOffsets` being reads). `produce`
  (`produce.go:59`) checks `AssertWritable`; `ProduceSync` partial failure reports
  `FirstErr` after some records landed (affected-rows truth). Header map iteration order
  (`toRecordHeaders`, map loses order and duplicate keys).
- **sqs.** `ReceiveMessage` is a side effect: every browse hides up to `pageSize` messages for the
  queue's visibility timeout and bumps `ApproximateReceiveCount` (DLQ `maxReceiveCount` can move a
  browsed message to the DLQ). Read-only connections still receive: weigh whether that is a
  write under the read-only contract. FIFO: receiving locks the message group. `forDelete`
  (`read.go:128`) boundary uses local `receivedAt` set after the call returns (clock skew against
  the server's own timer); `receiptHandleCap` 5,000 eviction; same `MessageId` received twice.
  Purge is not exposed (confirm no path). `resolveQueueURLCached`: stale URL after a queue is
  deleted and recreated, cache keyed by name across regions.
- **s3.** `scopedBucket` is enforced only in `listBuckets` (`catalog.go:23`): `resolveObjectTarget`
  (`adapter.go:141`), `Mutate` and `DownloadObject` accept any bucket in the path. Weigh whether
  the option is a convenience or a boundary users rely on. Keys: `listPrefixChildren` (`:62`)
  joins prefix segments with `/`: keys with `//`, a leading `/`, an empty segment, a trailing
  `/` object, `..`, unicode normalisation; the object leaf carries the full key, so a prefix
  segment and a key can disagree. Continuation-token paging loop bound (`rounds`), truncated
  listings. `applyDelete` (`mutate.go:289`) HeadObject then DeleteObject: TOCTOU, versioned
  buckets (delete marker, not deletion), delete of a "directory marker". `applyUpdate` falls back
  to an unconditional `PutObject` on `NotImplemented`, losing the race protection. Upload
  (`openUploadBody` `transfer.go:103`): 5 GiB single PUT cap versus S3's own 5 GiB limit and
  S3-compatible stores' lower limits; no multipart; non-regular files (FIFO, device, directory)
  passed as source. Download: `destPath` overwritten by rename, temp file in the destination dir.
  `readObject`: how much of a large object is fetched into the key-value page. Presigned URLs:
  confirm none is generated, logged or returned.
- **awscfg.** URI mode puts the access key and secret in URI userinfo (`config.go:43-49`); fields
  mode maps `Username` to a shared profile name. Weigh: secret in any error message, log line,
  `ConnectInfo.Details` or `op.SetCommand`; `endpoint` option logged verbatim (`:74`, an endpoint
  URL with userinfo leaks); a URI with username but no password silently falls back to the
  default chain (env vars, `~/.aws`, IMDS) instead of failing; region taken from URI host with no
  validation; `MapError` passing `err.Error()` verbatim (smithy text includes request IDs and
  host, not credentials: confirm, including for STS/SSO errors from the chain).

### 5.3 Pagination, type fidelity and decoding

- **mongo.** EJSON round trips (`buildReadPage`, `docsToPage`, `bson.MarshalExtJSON` canonical vs
  relaxed): `Decimal128`, `int64` past 2^53 in relaxed mode, `NaN`/`Infinity`, dates before 1970
  or past 9999, `Binary` subtypes incl. UUID, `Regex` options, `Timestamp`, `MinKey`/`MaxKey`,
  `DBRef`, `Code`, duplicate field names, field order. Read back then saved through `$document`
  must not change type (`int32` to `int64`/`double`, relaxed date). `_id` typing:
  `keysetIDCondition` (`read.go:462`) cross-type `$or` widening against `bsonSortTiers`
  (`:362`): numeric tiers, `null`/missing `_id`, `Decimal128`, array `_id` (not allowed) and
  `MinKey`. Offset `skip` cost on large collections; `limit`/probe row; token from another
  collection or filter (`RequestFingerprint`).
- **redis.** Binary-unsafe values in string/list/hash/set/zset/stream readers (`jsonx` encoding),
  zset scores (`inf`, precision), stream IDs, very large values truncated or not, TTL display
  (`-1`/`-2`), `KeyTypes` pipeline per db against a key deleted mid-window.
- **kafka.** Window arithmetic (`advanceWindows`, `clampExhaustedWindows`): empty partition,
  `low == high`, compacted gaps, transactional markers, retention moving `low` past a token's
  `Next`, partitions added between pages, a forged/old page token (windows decoded from JSON with
  no validation of partition set or offsets, only the fingerprint), negative offsets in the
  filter (`resolveStartOffsets` clamps), `ListOffsetsAfterMilli` with a future timestamp, record
  order across partitions in one page. `buildStreamRow`: non-UTF-8 keys/values/headers, null key
  vs empty key, tombstones (nil value), header with nil value, record timestamp type.
  `countTopic` exactness with compaction.
- **sqs.** `encodeHeaders` for binary/number attributes, `SentTimestamp` parse, `pageSize` over
  the 10-per-call cap loop, `HasMore` always false.
- **s3.** Metadata header decoding (non-ASCII `x-amz-meta-*`), `ContentType`/`ContentEncoding`
  preserved on edit, `formatBytes` boundaries, ETag quoting.

### 5.4 TLS, credentials and errors

- `ParseSSLMode` per engine: mongo `tlsConfigForSslmode` (`require`/`prefer` verify, unlike pg);
  a mongo URI with its own `tls=`/`tlsInsecure=` query params overriding or conflicting with the
  `sslmode` option; redis `rediss://` vs `sslmode`; kafka `resolveTLSOpt`. Silent downgrade to
  plaintext on any spelling.
- Credentials in error text and details: mongo driver errors echoing the URI, redis `AUTH` in
  `op.SetCommand` (the console denies `AUTH`, but check `HELLO ... AUTH` and `MIGRATE ... AUTH`
  / `AUTH2` text logged before refusal), kafka SASL failures, awscfg (above). Must not re-leak
  what Part 2 locked down (URI `password` param moved to the secret store).
- `mapError` per engine: redis maps `context.DeadlineExceeded` to `E_QUERY`, not `E_TIMEOUT`;
  mongo `errors.go` says data-plane errors never see `context.Canceled` (detached ctx): check the
  catalog paths that do pass the op ctx. Consistent codes across engines for the same condition.

### 5.5 Caps and registry

- Every `Caps()` false matches an `Unsupported` return no caller reaches (redis `Describe`/
  `Definition`/`SchemaColumns`, sqs `Describe`, kafka `Execute`, `KeyTypes`, `DownloadObject`).
  Leaf `Children` returns `[]`, never an error (pre-plan watch).
- `caps.go` per engine against `shared/caps.ts` (Part 13, Stream C): read only; a mirror fix is
  tagged (§8).

### 5.6 Conformance and unit tests

- Conformance suites (`SA/{mongo,redis,kafka,sqs,s3}/*_test.go`) are **exempt** from the unit-test
  bar (`CLAUDE.md`). Keep per-capability coverage; report only true duplicates or a suite that no
  longer guards what its name says.
- Missing coverage is a valid finding where a Part 3 lifecycle scenario has a real Part 4
  analogue: cancel-then-reuse, Stop on a hung op, Disconnect with a hung op, Connect cancelled.
  `ConnectionLifecycleScenarios` is shaped for pinned-connection engines (catalog query on
  `Children(root)`); propose an engine-fit variant only where the scenario applies.
- `awscfg` has no test: decide whether its logic clears the bar (URI/fields branching plus error
  classification) or rightly has none.

## 6. What earlier fixes already changed (do not re-report)

- **P108 Part 5** (v1.9, F1-F14, all in code): redis connection-state denylist (F1), kafka
  `advanceWindows` per-partition `recordsThisRound` (F2), `Guarded` handle state in all five
  engines and sqs `cacheQueueURL` nil guard (F3), mongo `QueryTracker` plus Snapshot/Cancel/Drain
  and `disconnectTimeout` (F4), s3 preserved attributes, tag refusal, `IfMatch`/`IfNoneMatch`
  with `NotImplemented` fallback (F5), mongo `_id` cross-type keyset (F6), missing `_id` (F7),
  console EJSON resolution (F8), sqs FIFO group/dedup sentinels (F9), receipt-handle expiry
  (F10), parse-all-before-run in mongo/redis console (F11), redis-cli escapes (F12), mongo
  userinfo escaping and `JoinHostPort` (F13), kafka doc (F14). Verify they hold; do not re-report.
- **P168 Part 2** (`dd8f971`..`c7cc630`): no Part 4 file edited. Consequences in scope: Connect
  ctx promptness (§5.1); URI `password` param now a stored secret and `sslpassword`/
  `tlsCertificateKeyFilePassword`/`proxyPassword` refused by `Validate` (affects mongo URI
  options); `model.UTF16Len` length rules.
- **P168 Part 3** (`140b4a7`..`1a613e6`): no Part 4 file edited. Core additions: `ConnGuard`
  (`connguard.go`, postgres/mysqlfamily only), `QueryTracker.PopRunningWith`, `ConnSet.Drop`,
  `SQLDialect` lexer, `BuildKeysetWhereSQL` binary keys, testsupport `PausableProxy` and
  `ConnectionLifecycleScenarios`. `QueryTracker` semantics mongo relies on are unchanged
  (`PopRunning` wraps `PopRunningWith(nil)`). Not a finding that Part 4 does not use them; a
  finding only where an engine has the bug they fix.
- **P166/P167.** `docs/v2.0/plans/P16{6,7}-code-review.md` absent on this branch and on `v2.0`
  (both fixed). Nothing to skip.

## 7. Watch items

Pre-plan §5.3: `sqs` queue-URL cache and receipt handles; `kafka` ephemeral browse clients;
`mongo` `inFlight` against `Disconnect` (now `QueryTracker`); `redis` per-db connection set;
leaf-returns-`[]` in `Children`; conformance exemption. Folded into §5.1, §5.2, §5.5, §5.6.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (shared callee first, then engines by size and
  risk). About 8.5k production lines plus 7.3k test lines: one agent pass covers it if tests are
  read only where they are the sole guard of a claim.
  1. **awscfg** (`config.go`, `errors.go`), then the core contract Part 4 relies on, read as
     callee only (`abort.go`, `tracker.go`, `connset.go`, `guarded.go`, `rowops.go`, page-token
     helpers in `sqltext.go`).
  2. **mongo**: `client`, `adapter`, `literal`, `console`, `read`, `mutate`, `catalog`,
     `definition`, `errors`, `caps`.
  3. **redis**: `client`, `adapter`, `console`, `catalog`, `read`, `mutate`, `errors`, `caps`.
  4. **kafka**: `client`, `adapter`, `read`, `produce`, `catalog`, `definition`, `errors`,
     `caps`, `kafka`.
  5. **sqs**: `client`, `adapter`, `read`, `mutate`, `catalog`, `definition`, `errors`, `caps`.
  6. **s3**: `client`, `adapter`, `catalog`, `read`, `mutate`, `transfer`, `errors`, `caps`.
  7. **Tests**: conformance and internal tests per engine; confirm the guard claims cited in
     findings and the §5.6 coverage questions. Real-container runs here if not done earlier.
- **Resumable:** write `docs/v2.0/plans/P168-part4-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 4 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). Mark each block done in the file's coverage section. An
  interrupted run reads the file, resumes at the first block not marked done, and never
  re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome; say which probe or real run
  confirmed it), and a proposed fix. Tag `design-decision` when it needs one; the fixer turns it
  into its own `SPEC.md` phase.
- **Edit scope tag.** The fixer may edit Part 4 files and Stream A one-hop files (Parts 2-3
  closed, Parts 5-9 later; pre-plan §3.3). A finding whose fix needs a file outside that set
  carries `needs-other-part-file: <path> (Part N)`. That covers every Stream C file
  (Parts 10-13: e.g. `shared/caps.ts` Part 13, `shared/domain/streamFilter.ts` and
  `views/{documents,keyvalue,stream,browse}` Part 12) and every Stream B file (Parts 14-23). The
  orchestrator routes those; the Part 4 fixer never edits them.
- The findings file states base commit (`1a613e6`), HEAD reviewed, checks run and results
  (vet, race, real-container suites and their images), findings, then coverage per block:
  reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk with nothing real says
  so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 4 findings`, normal commit, hooks green, before any fixer
  starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 4`. A fix
  re-runs `go build ./apps/kira-studio/...`, `go vet` and `go test -race` over
  `SA/{mongo,redis,kafka,sqs,s3,awscfg}/...`, plus `adapterhost`, `dbmcp`, `ipcfixture` when a
  caller or contract changed, and the real-container suite of each touched engine when Docker is
  up. A core change (Part 3 file) also re-runs `SA/...`. It deletes the findings file when done.
  Chunk lands per pre-plan §3.4 before Part 5's plan starts.

## 9. Out of scope

- Part 3's core and SQL engines beyond the contract Part 4 uses; `testsupport` internals (Part 3,
  closed) except where a Part 4 suite's correctness depends on one.
- `adapterhost`, `enginecache`, `page`, `tree`, `ipcfixture` internals (Part 5) and `dbmcp`
  policy (Part 6), beyond the contract each relies on from this chunk.
- `storage/model` validation and `connections` (Part 2, closed).
- Frontend views, `shared/caps.ts`, `streamFilter.ts` (Stream C): read only for mirrors; fixes
  tagged per §8.
- Root `internal/*` incl. `jsonx` (Part 8): record only as a callee note when it breaks a Part 4
  contract.
- Generated code, docs, excluded files (pre-plan §6).
