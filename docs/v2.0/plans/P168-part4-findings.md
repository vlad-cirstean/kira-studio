# P168 Part 4 findings: Studio DB adapters II (document, key-value, stream, object-store)

Plan: `P168-part4-nosql-adapters.md`. Reviewer: one Opus pass, report only.
Base commit: `1a613e6`. HEAD reviewed: `4123010` (plan commit on top of base; no Part 4 code
change between them).

## Checks

Pending (block 7).

## Findings

Ranked high, medium, low within the final list. IDs are stable once committed.

### F1 (low) awscfg: URI with access key but no secret silently uses the ambient credential chain

- `apps/kira-studio/internal/adapters/awscfg/config.go:43-50`
- `u.User` set with a username but no password adds no credentials provider, so
  `LoadDefaultConfig` falls back to env vars, `~/.aws` default profile, SSO or IMDS.
- Scenario: user saves `sqs://AKIAEXAMPLE@us-east-1` and the secret store has no password (never
  entered, or cleared). Connect succeeds with whatever identity the host machine has (e.g. an
  admin default profile), not the key the user named. Browse and writes run as that identity.
- Fix: in URI mode, a non-empty username without a password is a config error
  (`mapConfigError("an access key needs a secret key ...")`); an empty userinfo keeps the default
  chain on purpose.

### F2 (medium) mongo literal parser: unbounded recursion crashes the whole process

- `apps/kira-studio/internal/adapters/mongo/literal.go:406-547` (`ParseValue` ->
  `parseObject`/`parseArray` -> `ParseValue`, no depth limit).
- Scenario: console statement, grid filter or `run_query` text holding about 1.5 MB of `[`.
  Probe (throwaway `_test.go`, deleted): `ParseJSON5Literal(strings.Repeat("[", 1_500_000))`
  dies with `runtime: goroutine stack exceeds 1000000000-byte limit`; 700,000 returns a normal
  parse error. A Go stack overflow is fatal, not a recoverable panic: the Studio process exits.
  No statement-length cap sits in front (`dbmcp` `run_query` passes `args.SQL` straight through),
  so an MCP agent can kill the app with one call.
- Fix: carry a depth counter in `LiteralParser`; refuse past a fixed limit (BSON's own nesting
  limit is 100 levels, so a few hundred is generous) with `CodeQuery` "literal nested too deep".

### F3 (medium) mongo Stop misses an op between cursor batches and leaves it running with no deadline

- `apps/kira-studio/internal/adapters/mongo/adapter.go:373-406` (`Cancel`),
  `console.go:242-259` (`runCursorOp`), `read.go:325-336`, `abort.go:26-45`.
- `Cancel` only finds work through `$currentOp` with `idleConnections: false` and the default
  `idleCursors: false`, so it sees an op only while a command is executing on the server. The op
  itself runs on `RunWithAbortRace`'s `context.WithoutCancel` ctx, which has no deadline and no
  cancel path of its own.
- Scenario: console `db.events.find()` on a large collection. `cursor.All` loops `getMore`; most
  wall time is spent between commands (network transfer, client decode). User presses Stop:
  `CancelOp` cancels the op ctx (the UI shows cancelled), `Cancel` runs `$currentOp`, finds no
  active `getMore`, returns false. The detached goroutine keeps fetching and buffering the whole
  collection into `[]bson.D`, then throws it away; the server cursor stays open until exhausted.
  Same for a Stop issued before the command reaches the server (server selection, pool checkout).
  Code-read; the driver does tag `getMore` with the comment on 4.4+ (`x/mongo/driver/
  batch_cursor.go:429-436`), so killOp works only when the timing lands on an executing command.
- Fix: keep a per-op `context.CancelFunc` for the detached ctx (register it beside the tracker
  token) and call it from `Cancel` in addition to killOp; the driver then stops the `getMore` loop
  and `cursor.Close` kills the server cursor. Optionally also query `$currentOp` with
  `idleCursors: true` and `killCursors` the matched cursor.

### F4 (medium) mongo console `deleteMany()` / `deleteOne()` with no argument delete with an empty filter

- `apps/kira-studio/internal/adapters/mongo/console.go:415-453` (`runFilterOnlyOp` uses
  `argOrEmptyDoc`, so a missing filter becomes `{}`).
- Scenario: user (or agent through `run_query`, classified write and allowed) types
  `db.users.deleteMany()` while still composing the filter and runs it. Every document in
  `users` is deleted. `deleteOne()` deletes an arbitrary document. mongosh refuses both
  ("Missing required argument at position 0"); this console silently widens to all documents.
- Fix: `deleteOne`/`deleteMany` require an explicit filter argument (keep the `{}` default only
  for `find`/`findOne`/`countDocuments`); an explicit `{}` still deletes everything on purpose.

### F5 (low) mongo `NumberInt` silently wraps out-of-range values

- `apps/kira-studio/internal/adapters/mongo/literal.go:321-329` (`int32(f)` with no range check).
- Probe: `ParseJSON5Literal("NumberInt(\"3000000000\")")` returns `int32(-2147483648)`, no error.
  An insert or filter then stores or matches a wrong value. `NaN`/`Inf` inputs are rejected by
  `ParseFloat`'s error path only for unparsable text, not for range.
- Fix: reject values outside `math.MinInt32..math.MaxInt32` (and non-integral values, if the
  shell truncation is not wanted) with the existing "invalid NumberInt" error.

### F6 (low) mongo: deprecated BSON types do not survive a grid edit

- `apps/kira-studio/internal/adapters/mongo/literal.go:571-585` (`ejsonWrapperKeys` lacks
  `$symbol`, `$undefined`, `$dbPointer`), read side `read.go:236` (canonical EJSON).
- Probe: canonical output of `bson.Symbol("x")`/`bson.Undefined{}` is
  `{"$symbol":"x"}`/`{"$undefined":true}`; `ResolveEJSONWrappers` returns them as plain nested
  documents. Scenario: a legacy document holding a Symbol field is opened and saved unchanged
  through the `$document` replace; the field is rewritten as an embedded document
  `{ "$symbol": "x" }` (MongoDB 5.0+ accepts `$`-prefixed nested names), silently changing type.
- Fix: add the three keys to `ejsonWrapperKeys` (`bson.UnmarshalExtJSON` decodes all three).

### F7 (low) mongo console cannot address collections whose names are not ASCII identifiers

- `apps/kira-studio/internal/adapters/mongo/console.go:99-157` (`parseStatement` takes the
  collection from one `ExpectIdent` token; `literal.go:66-70` identifiers are `[A-Za-z_$][A-Za-z0-9_$]*`).
- Scenario: collections `orders.archive`, `my-coll`, `système` are listed in the tree but the
  console cannot reach them: `db.orders.archive.find()` parses as collection `orders`, method
  `archive` ("unsupported console method"); `db["my-coll"].find()` and
  `db.getCollection("my-coll").find()` fail to parse. mongosh accepts all three forms.
- Fix: accept `db.getCollection("<name>")` and `db["<name>"]` (string token) as the collection
  term, and dotted segments before the method name (last identifier before `(` is the method).

### F8 (low, design-decision) console results are fully materialised with no row or byte cap

- `apps/kira-studio/internal/adapters/mongo/console.go:242-259` (`runCursorOp`: `cursor.All`
  into `[]bson.D`, then a page of every document); `redis/console.go:388` plus `resultToPage`
  (`KEYS *`, `HGETALL`, `LRANGE k 0 -1`, `SMEMBERS` on a huge key: whole reply in memory, one row
  per element).
- Scenario: `db.events.find()` on a 10 GB collection buffers every document as `bson.D`, then
  again as EJSON text in the page builder (per-cell truncation only, `page/builder.go:207`) before
  `dbmcp` caps rendered rows. Memory grows until the process is killed. The SQL consoles share
  the same shape (no row cap in `postgres`/`mysqlfamily` console), so this is a cross-engine
  decision, not a Part 4 regression. Combined with F3 the buffering also continues after Stop.
- Fix: decide a console row cap (e.g. a few thousand rows plus a "truncated" flag on the page),
  applied in `runCursorOp` with `SetBatchSize`/early cursor close; same cap for the SQL consoles.

### F9 (medium) redis console: slow and blocking commands are silently re-sent, then reported as a connection failure

- `apps/kira-studio/internal/adapters/redis/client.go:151-179` (`dial` leaves go-redis defaults:
  `ReadTimeout` 5 s, `MaxRetries` 3, `ContextTimeoutEnabled` false), `console.go:388`
  (`conn.Do(ctx, argv...)`), `errors.go:38-40` (timeout is a net error, so `E_CONNECT`).
- go-redis v9.22 retries a read timeout for any command without its own read timeout
  (`redis.go:1332-1443`, `error.go:84-119`), and generic `Do` never sets one. So any console
  command whose reply takes over 5 s is written to the server again, up to four times in all.
- Real run (throwaway `_test.go` against `redis:8.10`, deleted): `BLPOP nokey 5` failed after
  20.1 s with `read tcp ...: i/o timeout` (four attempts); `WAIT 1 5000` took 20.1 s; a
  `BLPOP nokey 10` whose ctx was cancelled after 0.5 s returned only after 5.0 s (Stop waits for
  the socket deadline: `ContextTimeoutEnabled` false means ctx never reaches the read). A Lua
  script running about 5 s returned `BUSY Redis is busy running a script` to the user although the
  first attempt ran to completion and its write landed.
- Failure scenarios: `XREAD BLOCK 10000 ...` (allowed on a read-only connection),
  `BLPOP q 0`, `WAIT 1 10000` always fail after about 20 s as `E_CONNECT`, which reads as a dropped
  connection. A slow non-idempotent write (a script between 5 s and the busy limit, a large
  `DEL` reporting its count) is re-executed or misreported.
- Fix: console path uses `MaxRetries: -1` (a separate console client options set, or
  `conn.WithTimeout` plus no retry) and `ContextTimeoutEnabled: true` so Stop interrupts the read;
  either reject blocking forms with an unbounded or over-limit timeout, or set the per-command
  read timeout from the command's own timeout argument. Map a read timeout to `E_TIMEOUT`, not
  `E_CONNECT`.

### F10 (low) redis read-only gate refuses every container subcommand, including pure reads

- `apps/kira-studio/internal/adapters/redis/client.go:195-208` (`isReadOnlyCommand` reads the
  top-level `COMMAND` entry by name only).
- Real run (same probe): on a read-only connection `XINFO HELP`, `OBJECT ENCODING k`,
  `MEMORY USAGE k`, `CLIENT LIST` all fail with "connection is read-only". Redis 7+ container
  commands carry no flags at top level; the read-only flag lives on each subcommand
  (`xinfo|stream`, `config|get`, `object|encoding`, `function|list`, `pubsub|channels`). Fail
  closed, so not a write escape, but every one of those reads is unusable on a read-only
  connection and `ClassifyStatement` classifies them as writes for `dbmcp` (prompt or deny).
- Fix: for a container command, look up `COMMAND INFO <container>|<subcommand>` (cache per name)
  and use the subcommand's flags; unknown stays deny.

### F11 (low) redis ConnSet eviction closes a client another op is still using

- `apps/kira-studio/internal/adapters/redis/client.go:128-135` (`Close` is an unconditional
  `c.Close()`), `adapters/connset.go:118-125` (victim chosen by LRU at `Get` time).
- Scenario: Browse tabs on nine or more db indices (Max 8, primary never evicted). A
  `listNamespaceChildren` walk on db3 (up to 200 SCAN rounds) got its client early; the user then
  opens db9, db10, ... and db3 becomes LRU and is closed mid-walk. The walk's next `SCAN` fails
  with `redis: client is closed`, mapped to `E_CONNECT` (`errors.go:41-43`): a healthy connection
  reported as broken. Code-read, not reproduced.
- Fix: reference-count entries handed out by `get` (release on op end) and defer `Close` of an
  evicted client until its count drops to zero, or raise Max to the server's `databases` count
  since a `*goredis.Client` per index is cheap when idle.

### F12 (low) kafka browse: tombstones and empty values render identically; binary payloads are irrecoverably replaced

- `apps/kira-studio/internal/adapters/kafka/read.go:113-116` (`body := ""` when
  `rec.Value == nil`), `:69-70` (header nil value becomes `""`), `:89`/`:115`
  (`strings.ToValidUTF8(..., "\uFFFD")`).
- Scenario: on a compacted topic, a delete (tombstone, null value) and a message whose value is
  the empty string both show an empty body; the user cannot tell which keys are deleted. A
  protobuf/Avro value shows as replacement characters with no way to see the bytes (no hex or
  base64 form), so browse is lossy for any binary topic. Key handling already distinguishes null
  from empty (`Key *string`), so the asymmetry is in the body only.
- Fix: carry a null flag for the body (the page builder already supports nullable cells via
  `StreamRow.Key`'s pattern; `Body` would become `*string`, which touches `page.StreamRow` and the
  renderer: `needs-other-part-file: apps/kira-studio/internal/page/builder.go (Part 5)`,
  `needs-other-part-file: apps/kira-studio/frontend/src/views/stream/page.ts (Part 12)`), and
  encode non-UTF-8 values as base64 with a marker instead of replacing bytes.

### F13 (low) kafka count claims exact but over-counts compacted and transactional topics

- `apps/kira-studio/internal/adapters/kafka/read.go:583-600` (`countTopic` returns
  `Exact: true` for the sum of `End - Next`), `caps.go` (`ExactCount: true`).
- Scenario: a compacted topic with offsets 0..1,000,000 of which 10,000 records survive, or a
  transactional topic where every commit marker takes an offset. The toolbar shows "1,000,000
  total" as exact while paging through the browse yields 10,000 rows (the browse itself handles
  the gaps via `clampExhaustedWindows`).
- Fix: report `Exact: false` (offset span is an upper bound), or `Exact: true` only when the
  topic's `cleanup.policy` is `delete` and no transactional producer wrote to it (not knowable
  cheaply, so the estimate flag is the honest answer).

### F14 (low) kafka produce: partial batch failure reports nothing landed; header order is randomised

- `apps/kira-studio/internal/adapters/kafka/produce.go:102-107` (`FirstErr` returns an error
  and `AffectedRows` is lost), `:42-51` (`toRecordHeaders` ranges over a `map`).
- Scenario: a plan with three messages; the second fails (e.g. `MESSAGE_TOO_LARGE`), the first
  and third are acknowledged. The op reports an error with no affected rows; the user retries all
  three and two are duplicated. Headers typed as `{"a":"1","b":"2"}` are produced in random order
  across runs (Go map iteration), and duplicate header names cannot be expressed.
- Fix: count successful results (`results` carries per-record `Err`) and return them with the
  error (message names which records failed); keep header order by decoding the JSON object with
  an ordered decoder (`internal/jsonx` already has ordered pairs) in `ParseHeaderJSON`
  (`needs-other-part-file` not needed: `adapters/rowops.go` is Part 3, a Stream A one-hop file).

### F15 (medium, design-decision) sqs browse on a read-only connection consumes messages

- `apps/kira-studio/internal/adapters/sqs/read.go:225-268` (`pollQueue` calls
  `ReceiveMessage` with the queue's own visibility timeout); no read-only branch anywhere in the
  read path (`adapter.go:179-193` passes no `readOnly`).
- `ReceiveMessage` is not a read: every browsed message is hidden from real consumers for the
  queue's visibility timeout (default 30 s, up to 12 h), its `ApproximateReceiveCount` goes up,
  and a FIFO receive locks the message group. Scenario: an operator opens a production queue on a
  connection marked read-only and polls it a few times to look at a stuck message. With a
  `RedrivePolicy` of `maxReceiveCount: 3`, the third poll moves the message to the DLQ; between
  polls the real consumer cannot see it. The connection's read-only flag promised "nothing but a
  read" and did not prevent either effect.
- Fix (needs a decision): on a read-only connection receive with `VisibilityTimeout: 0` (messages
  reappear at once; the receive count still rises), and refuse or confirm a poll on a queue whose
  `RedrivePolicy` would count it; or block browse on read-only connections outright and say why.
  Writable connections keep today's behaviour (the delete flow needs the hidden window).

### F16 (medium) s3 edit silently resets the object's ACL

- `apps/kira-studio/internal/adapters/s3/mutate.go:186-232` (`applyUpdate` re-`PutObject`s
  with `applyPreservedAttributes`, `:111-170`, which carries no ACL; `HeadObject` does not return
  one).
- Real run (throwaway `_test.go` on the localstack container, deleted): object written with
  `ACL: public-read` has 2 grants; one edit through `Adapter.Mutate` (`update`, `$value`) returns
  success and the object then has 1 grant (owner only). Scenario: a static-site or CDN-origin
  bucket on a legacy (ACL-enabled) account; fixing a typo in `index.html` through the editor makes
  the object private and the site returns 403. P108 F5 made the same class of silent attribute
  loss refuse the edit for tags; ACLs were missed.
- Fix: `GetObjectAcl` before the put; if it holds any grant beyond the owner's
  `FULL_CONTROL`, either refuse like the tag case or re-send the grants (`GrantRead`,
  `GrantReadACP`, `GrantWriteACP`, `GrantFullControl` on `PutObjectInput`). Skip the check when
  the bucket reports `BucketOwnerEnforced` (ACLs disabled).

### F17 (low) s3 `options.bucket` scope is enforced only on the root listing

- `apps/kira-studio/internal/adapters/s3/catalog.go:22-36` (only `listBuckets` reads
  `scopedBucket`); `adapter.go:116-148` (`Children`), `:168-185` (`resolveObjectTarget` for
  `Read`/`Count`/`DownloadObject`), `mutate.go:28-35` (`resolveBucketSegment`) accept any bucket.
- Real run (same probe): a connection scoped to `zz-acl-probe` lists and reads
  `zz-other-bucket/secret.txt` when handed a path rooted at the other bucket. Reachable from the
  MCP agent: `dbmcp` `list_children` passes the agent's encoded path straight to `Children`
  (`dbmcp/tools.go:96-105`), so an agent on a "one bucket" connection can enumerate every other
  bucket the credentials can reach. IAM is the real boundary, but the option reads as a scope and
  the tree honours it, so the agent and crafted paths should too.
- Fix: when `scopedBucket` is set, reject any path whose bucket segment differs (`E_NOT_FOUND`)
  in `Children`, `resolveObjectTarget` and `resolveBucketSegment`.

### F18 (low) s3 preview read trusts the HeadObject length; a replaced object is read whole into memory

- `apps/kira-studio/internal/adapters/s3/read.go:108-140` (`HeadObject` size check, then a plain
  `GetObject` and `io.ReadAll(res.Body)`).
- Scenario: the object is overwritten between the two calls (a log file rewritten by a job, a
  build artefact republished). Head said 3 MB, the Get returns the new 4 GB object, and
  `io.ReadAll` buffers all of it before the page builder truncates the cell. Code-read.
- Fix: `GetObject` with `IfMatch: head.ETag` (a mismatch becomes "object changed, reload") and
  read through `io.LimitReader(res.Body, ObjectBodyPreviewBytes+1)`.

### F19 (low) s3 upload accepts non-regular files and can hang outside ctx

- `apps/kira-studio/internal/adapters/s3/transfer.go:103-117` (`openUploadBody` checks size,
  not `info.Mode().IsRegular()`).
- Scenario: the chosen source is a named pipe: `os.Open` blocks until a writer appears, with no
  ctx, so Stop cannot end the op. A character device such as `/dev/zero` stats as 0 bytes and the
  SDK's checksum pass reads it forever. A directory fails later with a less clear error. Code-read.
- Fix: refuse anything but a regular file (`!info.Mode().IsRegular()`) with `E_QUERY` before
  `os.Open`.

## Coverage

- Block 1 (awscfg, core callee contract): done. `awscfg/config.go`, `awscfg/errors.go` reviewed
  in full. Core read as callee: `abort.go` (`RunWithAbortRace`: detached ctx, no deadline),
  `tracker.go` (`TrackerFor` no-op release while draining, `Drain` bounded by ctx), `connset.go`
  (`Get` single-flight, eviction `Close` unconditional, `CloseAll`). `url.Parse` error is replaced
  by a fixed message, so the URI (with secret) never reaches error text. `LoadDefaultConfig` with
  an explicit region does no IMDS region probe; credentials resolve lazily on the first request
  under the op ctx. `MapError` passes smithy text verbatim: operation, status, request ID, API
  message; no credential. Endpoint log line (`config.go:74`) logs the option verbatim; userinfo in
  an endpoint URL is not a supported shape, so not reported.
- Block 2 (mongo): done. All ten production files read in full: `client`, `adapter`, `literal`,
  `console`, `read`, `mutate`, `catalog`, `definition`, `errors`, `caps`. Verified, no finding:
  `Connect` returns promptly on ctx cancel (driver `Connect` is lazy, `buildInfo` server selection
  honours ctx, 10 s cap); probe failure disconnects the fresh client. `Disconnect` snapshot, cancel,
  bounded `Drain`, then `client.Disconnect` under a fixed 10 s deadline: bounded. `TrackerFor`
  no-op release while draining is covered by that deadline. `tlsConfigForSslmode` verifies for
  `require`/`prefer`, rejects unknown spellings; `SetTLSConfig` after `ApplyURI` overrides a URI
  `tlsInsecure`. `buildURIFromFields` escapes userinfo (P108 F13 holds). `isAggregateWrite`: the
  pipeline must be `bson.A` both for the check and for `asDocArray`, so no shape reaches the runner
  unchecked; escapes resolve before the key check; `$out`/`$merge` are illegal inside
  `$facet`/`$lookup`/`$unionWith`; `runAggregate` ignores extra args. `parseStatement` rejects
  trailing content and `;`, so one statement is one command. `ClassifyStatement` returns
  `ClassUnknown`+error on parse failure; `dbmcp` treats it as unknown, never as read. Grid bodies
  and ids use canonical EJSON, so numeric/date/binary types round-trip through `$document`
  (except F6). `\u` surrogate pairs decode correctly (probe). `keysetIDCondition` widening and
  missing-`_id` fallback hold (P108 F6/F7). `parseIdKey` operator documents cannot match a real
  `_id` (MongoDB forbids `$`-prefixed fields in `_id`). Catalog calls take the op ctx; cancel maps
  to `E_CANCELLED`. Caps match the unsupported stubs (`SchemaColumns`, `KeyTypes`,
  `DownloadObject`); leaf `Children` returns `[]`. Whole-document `ReplaceOne` is last-writer-wins
  (no version check); same as the SQL grid's PK-only update, not reported.
- Block 3 (redis): done. All eight production files read in full: `client`, `adapter`,
  `console`, `catalog`, `read`, `mutate`, `errors`, `caps`. Real probes against `redis:8.10`
  (throwaway, deleted) for F9/F10. Verified, no finding: `Connect` dial takes ctx with a 10 s dial
  timeout and closes the client on ping failure; the second `set.primary` hits the cached entry.
  `rediss://` and every `sslmode` spelling enable TLS; unknown spellings fail; no plaintext
  downgrade. `tokenize`: a newline is whitespace and RESP framing sends one command per statement;
  `\x` escapes produce raw bytes (P108 F12 holds). Denylist holds for `SELECT`, `MULTI`/`EXEC`,
  `WATCH`, the subscribe family, `MONITOR`, `HELLO`, `AUTH`, `RESET`, `QUIT`, `CLIENT REPLY`
  (P108 F1). `CLIENT TRACKING` under RESP2 needs `REDIRECT`; `CLIENT KILL` on the pool's own
  connections only forces a redial; neither corrupts pooled state. Read-only probe: `PUBLISH`,
  `CLIENT KILL`, `SCRIPT FLUSH`, `FUNCTION FLUSH`, `CONFIG SET` refused; `SORT_RO` and
  `XREAD BLOCK` allowed. `COMMAND` failure fails closed and is not cached. `escapeGlobPrefix`
  escapes every MATCH metacharacter; paths encode names byte-wise, so binary keys round-trip.
  SCAN loops are bounded (200 rounds tree, page size per read). `XRANGE` uses an exclusive start
  and a `pageSize+1` probe. PTTL sentinels handled. `KeyTypes` reports `none` for a key deleted
  mid-window. `AUTH` text never reaches `SetCommand` (denied before execution, and `HELLO` is
  denied whole). `assertEditableType` then `SET KEEPTTL` is a TOCTOU of one round trip; same
  last-writer-wins class as the SQL grid, not reported. `dbIndexFromName` maps an overflowing
  `db<digits>` to db 0; only a hand-crafted path reaches it, same server, not reported. Caps
  match the unsupported stubs; leaf `Children` returns `[]`. `Cancel` no-op: see F9 for what Stop
  actually does.
- Block 4 (kafka): done. All nine production files read in full: `client`, `adapter`, `read`,
  `produce`, `catalog`, `definition`, `errors`, `caps`, `kafka` (doc). Verified, no finding: browse
  uses `kgo.ConsumePartitions` only; no `ConsumerGroup`, `ConsumeTopics` or `CommitOffsets` is
  reachable; `buildGroupDefinition` uses `DescribeGroups`/`FetchOffsets` (reads). `produce`
  checks `AssertWritable` first. `Connect`: `Ping(ctx)` and `Metadata(ctx)` honour ctx; client
  closed on failure. Browse client is per page, closed by `defer`, bounded by `pollTimeout` 1 s
  rounds and 2 empty polls; `Disconnect` never shares it, so no leak and no hang. TLS verifies by
  default; unknown `sslmode` fails. Credentials never reach error text (fixed messages for URI
  parse; franz-go SASL errors carry no password). Forged or stale page tokens are bounded: an
  unknown partition or an `End` past the log ends after two empty polls and is clamped. Retention
  moving `low` past `Next` resets to the start and the `rec.Offset < w.Next` guard keeps order.
  Candidate refuted by a real run (throwaway `_test.go` on the kafka container, deleted): a fetch
  response cut by `FetchMaxBytes`/`FetchMaxPartitionBytes` (forced down to 300 KB/200 KB over four
  partitions of 1.2 MB each) never clamped a window mid-data; 80 of 80 rows browsed under both
  default and small limits. `ErrClientClosed` branch in `pollRound` is unreachable (the browse
  client closes only after the loop) but harmless. Caps match the unsupported stubs (`Describe`,
  `SchemaColumns`, `Execute`, `KeyTypes`, `DownloadObject`); leaf `Children` returns `[]`.
- Block 5 (sqs): done. All eight production files read in full: `client`, `adapter`, `read`,
  `mutate`, `catalog`, `definition`, `errors`, `caps`. Verified, no finding: no `PurgeQueue`,
  `DeleteQueue` or other destructive queue call exists; `dbmcp` has no read tool and SQS has no
  console, so only an explicit UI poll receives. `Mutate` checks `AssertWritable` first.
  `cacheQueueURL` after `Disconnect` is a no-op (P108 F3 holds); an op past `requireClient` keeps a
  valid client (the SDK holds no per-connection socket state) and a cleared `receiptHandles` makes
  a racing delete fail with "poll again", never succeed wrongly. Queue URLs are deterministic per
  account and name, so a recreated queue reuses its URL; the cache is per adapter instance (one
  region). `forDelete` measures from a local `receivedAt` taken after the receive returned: the
  error is one round trip in the safe direction for the client but up to one round trip late
  against the server's timer; too small to report. Same `MessageId` received twice keeps the
  newest handle. FIFO group/dedup sentinels hold (P108 F9). Cap of 5,000 handles evicts oldest.
  `encodeHeaders` base64s binary attributes; `SentTimestamp` parse failure leaves the cell null.
  Every SDK call takes the op ctx; `Connect` returns on ctx cancel through `LoadDefaultConfig(ctx)`
  and `ListQueues(ctx)`. Caps match the unsupported stubs; leaf `Children` returns `[]`.
- Block 6 (s3): done. All eight production files read in full: `client`, `adapter`, `catalog`,
  `read`, `mutate`, `transfer`, `errors`, `caps`. Real probe on localstack for F16/F17 (deleted).
  Verified, no finding: no presigned URL is generated anywhere (`git grep Presign` empty in
  `s3`); no bucket delete. `Mutate` checks `AssertWritable`; download is a read by contract.
  `listPrefixChildren` key edge cases: `a//b` yields an empty-name prefix segment that re-joins
  to `a//`, a leading `/` yields segment `""` that re-joins to `/`; the object leaf carries the
  full key, so prefix segments never have to agree with it. 20-round listing cap with a truncated
  flag. Directory markers are hidden (not deletable from the UI; by design). Insert uses
  `IfNoneMatch: *`, update uses `IfMatch` with a logged unconditional fallback on
  `NotImplemented` (P108 F5 holds; tags refused). Delete in a versioned bucket writes a delete
  marker, the safe outcome; HeadObject-then-Delete TOCTOU is harmless. Download: sibling temp
  file, removed on every error path, ctx cancel surfaces mid-`io.Copy`, rename last; upload file
  closed by `defer`, rewound before the fallback put. 5 GiB cap equals AWS's single-PUT limit.
  `Disconnect` only clears state; an op past `requireClient` finishes on a still-valid client.
  Caps match the unsupported stubs (`Describe`, `Definition`, `SchemaColumns`, `Execute`,
  `KeyTypes`); leaf `Children` returns `[]`.
- Block 7 (tests, real-container runs): not reached.
