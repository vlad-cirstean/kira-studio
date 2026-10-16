# P108 Part 5 — review plan: Studio DB adapters II (document, key-value, stream, object-store engines)

Chunk A4, stream A position 4 (pre-plan §5.4). One Opus reviewer runs this plan and reports
findings. It fixes nothing. One Sonnet fixer then lands the findings. Tree surveyed: `40cb03e`
(Part 4's fixes F1-F12 landed, its result recorded).

Paths are repo-relative. `SI` = `apps/kira-studio/internal`, `SA` = `SI/adapters`.

## 0. Method

- **`codegraph_explore`** for discovery: the adapter contract (`SA/adapter.go` `Adapter`,
  `OpCtx`), registry and caller path (`adapterhost.Router.Connect`/`Test`/`Disconnect`,
  `Host.RunOp`), and the shared core these engines consume (`RunWithAbortRace`, `ConnSet`,
  `QueryTracker`, `ClassifyNetError`, `RequireConnected`, `LeafChildren`).
- **Driver source read in the module cache** where a claim depends on driver behavior:
  `mongo-driver/v2@v2.9.1` (`Client.Disconnect`, `options.Find`, `bson.UnmarshalExtJSON`),
  `go-redis/v9@v9.22.0` (`Do`, `Scan`, pool `Close`), `franz-go@v1.21.6` and `kadm@v1.18.0`
  (`PollFetches`, `ConsumePartitions` offsets, `Close`), `aws-sdk-go-v2` `sqs@v1.52.0`
  (`ReceiveMessage`, `ChangeMessageVisibility`, `DeleteMessage`) and `s3@v1.113.1`
  (`ListObjectsV2`, `GetObject` body, `PutObject`).
- **Throwaway probe tests** in the package dir, deleted after the run, never committed, only
  where a claim depends on runtime behavior of this chunk's own parsing (`mongo/literal.go`,
  the Redis console tokenizer).
- **`go test -race`** over every own package. Real-container suites skip without Docker; the
  unit-level half must pass.

## 1. Own file set

Production files. `_test.go` files are read only where they are the package's own guard or a
conformance suite (`CLAUDE.md` exemption).

- **`SA/mongo`** (10, ~2.6k): `adapter,caps,catalog,client,console,definition,errors,literal,mutate,read`.
- **`SA/redis`** (8, ~1.8k): `adapter,caps,catalog,client,console,errors,mutate,read`.
- **`SA/kafka`** (9, ~1.5k): `adapter,caps,catalog,client,definition,errors,kafka,produce,read`.
- **`SA/sqs`** (8, ~0.8k): `adapter,caps,catalog,client,definition,errors,mutate,read`.
- **`SA/s3`** (8, ~1.0k): `adapter,caps,catalog,client,errors,mutate,read,transfer`.
- **`SA/awscfg`** (2, 159): `config,errors`.

About 8.1k production lines; conformance suites about 5.9k more.

## 2. One hop: callers

The five engines are imported only by `main.go`'s blank imports; every call arrives through the
`adapters.Register`/`CreateAdapter` registry.

- **`adapterhost`** (Part 6, read only): `Router.Connect` (reconnect path calls
  `existing.Disconnect(context.Background())` outside `RunOp`, no bound), `Router.Test`
  (deferred unconditional `Disconnect`), `Router.Disconnect`, `Router.Cancel` to `Host.CancelOp`
  (local ctx cancel first, then `adapter.Cancel`), `Dispatcher.Read/Count/Mutate/Execute`,
  `DownloadObject`/`UploadObject` for S3. `Host.RunOp` runs ops for one connection on separate
  goroutines with no per-adapter serialization.
- **`dbmcp`** (Part 7): `run_query` through `ClassifyStatement` (Mongo and Redis implement
  `StatementClassifier`) then `Execute` — the permission gate for agent-issued commands.
- **`tree`**, **`connections`**, **`SI/bridge`**, **`ipcfixture`**: consume `Children`,
  `Connect`/`Disconnect`, pages.

## 3. One hop: callees

- **`SA` core** (Part 4, closed): `RunWithAbortRace` (Mongo 12 sites, S3 2, Kafka 1, SQS 1),
  `ConnSet` (Redis per-db-index set), `RunKindDispatched`/`DispatchUpdateDeleteInsert`,
  `AssertWritable`, `ClassifyNetError`, `EncodePageToken`/`DecodePageToken`/
  `RequestFingerprint`, `PaginationCursor/OffsetWindow/Batch/Token`, `PreviewProduce`,
  `ParseHeaderJSON`, `NoQueryConsole`, `CheckCancelled`/`CheckNotStarted`.
- **`SI/storage/model`** (Part 3, settled): `ResolvedConnectionConfig` (URI, secrets,
  `Options`), `NodePath`, `MutationPlan`, `ObjectDownloadRequest`/`UploadRequest`.
- **`SI/page`** (Part 6): document/key-value/stream page builders.
- **SDK clients** listed in §0.

## 4. Edge cases to weight

Security first: this chunk turns user and agent text into Mongo filters, Redis commands, S3 keys
and SQS/Kafka operations.

- **Mongo operator injection and parsing.** `literal.go` parses the console/filter text into
  BSON. Check `$where`/`$function`/`$accumulator` (server-side JS) and `$out`/`$merge` in an
  aggregate against `ClassifyStatement` and the read-only guard. A grid filter/sort string and
  `_id` values from a key path: can a string become an operator document? Parser edge cases:
  unterminated strings, nested depth, numeric overflow, `ObjectId(...)`/`ISODate(...)`
  helpers, duplicate keys.
- **Redis command injection and classification.** Console tokenizer quoting and escapes; one
  line becoming several commands; `EVAL`/`FUNCTION`/`MULTI`/`SCRIPT`/`MODULE`/`CONFIG`/`DEBUG`
  against `ClassifyStatement` (fail-closed on unknown?) and the read-only guard. Keys with
  spaces, glob metacharacters in `SCAN MATCH` built from a user filter, binary-unsafe key
  round trips through the tree path.
- **Kafka.** Partition/offset arithmetic at boundaries (empty partition, low == high, compacted
  gaps, negative offsets, offset past high water), per-partition ordering and cross-partition
  merge, the ephemeral browse client's lifecycle (closed on every path including cancel), a
  poll that never returns on an idle topic, produce acks and headers.
- **SQS.** `ReceiveMessage` is destructive-ish: a browse makes messages invisible. Visibility
  timeout choice, receipt-handle cache lifetime and eviction, `ChangeMessageVisibility` reset,
  delete with a stale handle, `MaxNumberOfMessages` bounds, queue-URL cache staleness after a
  queue is deleted and recreated, FIFO `MessageGroupId`/dedup on produce.
- **S3.** Object-key handling: `/`-prefix delimiters, keys containing `..`, leading `/`, empty
  segments, unicode; download target path on the local filesystem (path traversal via a key);
  upload source path; body close on every path; `ListObjectsV2` continuation-token paging;
  scoped-bucket enforcement (can a path name another bucket?).
- **Lifecycle and races (Part 4 F2-F4 analogues).** Unsynchronized handle fields written by
  `Connect`/`Disconnect` while ops read them (Part 4 F3 fixed exactly this for the SQL
  engines). Mongo's own `inFlight` `WaitGroup`: `Add` racing `Wait` (Part 4 F3's
  `QueryTracker` fix), unbounded `Wait` in `Disconnect` (Part 4 F4). Redis `ConnSet` usage
  (Acquire/eviction close vs in-flight command). Kafka/S3/SQS `RunWithAbortRace` goroutines
  using a client `Disconnect` already closed. `Connect` leaking a client when the probe fails.
- **Cancellation.** Which of these implement `Canceller`, and whether a Stop actually stops
  server work (Mongo `killOp`? Redis blocking commands?). A local abort must not leave a
  half-applied multi-document or multi-key mutation reported as failed.
- **Credentials in errors and details.** Mongo URI (with password) in driver errors,
  `ConnectInfo.Details`, `OpCtx.SetCommand` text; Redis `AUTH` in the console command log;
  AWS keys/session token in `awscfg` errors; Kafka SASL. Same class as Part 3/Part 4.
- **TLS options.** `sslmode` mapping per engine (Mongo `tlsConfigForSslmode`, Redis, Kafka),
  `verify-ca` versus `require` semantics, silent downgrade.
- **Pagination tokens.** Fingerprint binding, a token replayed against a different
  filter/sort, cursor arithmetic at page boundaries (`CLAUDE.md` test-bar exception applies).

## 5. Watch items (pre-plan §5.4)

- `sqs` queue-URL cache and receipt handles (concurrency, staleness, unbounded growth).
- `kafka` ephemeral browse clients (P58e E5): closed on every path.
- `mongo` `inFlight` `WaitGroup` against `Disconnect`.
- `redis` per-db connection set.
- Leaf-returns-`[]` rule 5 in `Children` for every engine.
- Every `Caps()` false must match an `Unsupported` return no caller reaches.
- Conformance suites are exempt from the unit-test bar (`CLAUDE.md`). Keep per-capability
  coverage; prune only true duplicates.

## 6. Out of scope

`adapterhost` reconnect ordering (`Router.Connect`'s unbounded `existing.Disconnect` outside
`RunOp`) is Part 6's. A finding here that needs it is reported with that hand-off noted.
