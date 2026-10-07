# P183 review: everything since P170

Report-only code review. One Opus pass over three dimensions: architecture/security,
functional correctness, performance.

- Base: `06cbb98` (P170 close-out, last review session).
- Head: `157f673` (`v2.0`, P182 result).
- Scope: `git diff 06cbb98..157f673`, 337 files, 107 commits. Covers P172, P173, P174, P175, P176,
  P177, P178, P179, P181, P182. Fixer commits in these files count as unreviewed.
- Discovery used `codegraph_explore` for owned files and one-hop callers per area.

Counts: high 0, medium 4, low 5. Plus 2 items parked for user input.

## Clean areas

Checked against current source, nothing real found:

- P172 peer credentials (`gitsock/peer*.go`, `handleConn`): fails closed on lookup error, UID check,
  pre-handshake 64 KiB read cap, post-admission revocation re-check. Token binding stays an
  existing Known open item.
- P172/P178 `refuseSpaceOnly`: `credential.provide` and `repoSettings.set` refused on `git.sock`.
  No stream method reaches either. Prepare-script leaf refused in `handleRepoSettingsSet` for
  every connection.
- P173 frame cap: Go `maxFrameBytes`, `maxGitStreamFrameBytes` and TS `MAX_FRAME_BYTES` all 32 MiB.
  `rpcstream.sendResult`/`sendChunk` answer `E_FRAME_TOO_LARGE` instead of a silent drop.
- P173 auto-fetch backoff (`nextAutoFetchDelay` shift clamp, cap, stop/rearm), `graph.reportFailure`
  (message composed server-side, never client text).
- Contract bump: Go `ContractVersion = 45`, TS `CONTRACT_VERSION = 45`, both history comments agree.
  No stale literal in fixtures.
- P174 SQL/Mongo/ClickHouse console caps: `Next` before the cap check makes `truncated` mean "more
  existed". Redis bounded forms (`planIndexRange`, `planLimit`, `planCount`, `runScan` dedupe).
  `dbmcp` `Truncated` now also honours the page flag. Binary marker (`page.BytesCell`).
- P174 PK-keyed staged edits (`pendingChanges.ts`): partial key refused while meta is known; the
  meta-not-loaded window still hits server `AssertKeyIsPrimaryKey`, no wrong-row write.
- P175 cookiejar fork: BSD LICENSE kept, upstream header, additions isolated in `entries.go`; a named
  requirement (stdlib jar exposes no entries/delete). Cookie query cancel-then-set ordering.
  `dotenv.ts` serialize/parse round trip, `mergeRawHeaders`.
- P176 deleted-connection guard, textarea cell editor, native clipboard in text controls.
- P178 relay (`gitcred.Relay`) ordering and withdraw; `gitCredential` store sync; extension trust.
  The relay queue is unbounded, but each prompt needs a live git op holding its repo's remote slot,
  so growth is bounded by open repos. `peerExe` costs one process lookup per accepted connection.
- P179 renames: values preserved (`SingleRowMaxBytes` = old `DocumentTruncateBytesSingle`).
- P181 storage: repo never selects `uri`, `SecretWrite`, duplicate copies ciphertext, reveal gated
  through `localauth.Gated`, Copy URI gated. Create/Test normalize (see F2 for Update).
- P182 sticky header/gutter: scroll hot path untouched; `getBoundingClientRect` shim is read only by
  SlickGrid's resize/drag measurements.
- Standing rules: every new/changed SFC is `<script setup lang="ts">`, no `<style>` block, no
  `defineComponent`. New Pinia stores stay one concern.

## Data plane and console (P174)

### F1. Console byte cap equals the data-frame cap, so a byte-capped result can never be shown

- File: `apps/kira-studio/internal/adapters/consolecap.go:10`,
  `apps/kira-studio/internal/adapterhost/dataframe.go:205`, `:262-279`.
- Severity: medium.
- Summary: `DefaultConsoleCap.Bytes` is 64 MiB of cell text per statement. The response refusal
  threshold is `maxResponsePayloadBytes = 64 MiB - 4096`, compared against
  `pageSizeEstimate(raw) = raw + raw/16 + 512` summed over every page in the batch.
- Failure scenario: a `SELECT` of wide text columns fills ~61 MiB of cells before 10,000 rows. Go
  holds it, stops correctly with `truncated`, then `oversizedPagePayload` refuses the whole response:
  "the response was too large to return". The user never sees the truncated result P174 promises.
  Same for a three-statement batch of 25 MiB each (sum 75 MiB): the whole batch is refused although
  each statement is under its own cap. Go also holds up to N x 64 MiB before refusing.
- Suggested fix: make the byte budget leave room for encoding overhead (e.g. budget =
  `maxResponsePayloadBytes / (1 + 1/16)` minus envelope) and apply it across the batch, not per
  statement (thread a shared remaining-bytes counter through `execute`). The batch-wide choice is
  parked as D1 below.

### F3. Read-only SQS poll can receive one message several times, and the first confirm never names the redrive limit

- File: `apps/kira-studio/internal/adapters/sqs/read.go:245`, `:260-292`;
  `apps/kira-studio/frontend/src/views/stream/StreamView.vue:107-112`, `:290-299`.
- Severity: medium.
- Summary: a read-only poll uses `VisibilityTimeout: 1` and loops batches until a batch adds
  nothing new. With `waitTimeSeconds = 1`, any batch issued after the first second re-receives
  already-shown messages. Each re-receive raises `ApproximateReceiveCount`. A mixed batch (some new,
  some seen) keeps the loop going. Separately, `redriveLimit` reads `page.value?.maxReceiveCount`,
  but the confirm runs before the first poll, when no page exists.
- Failure scenario: queue with 40 messages and `maxReceiveCount: 3`, page size 100. One "read-only"
  poll can receive early messages two or three times. The first confirm says only "Each poll raises
  the receive count" with no DLQ sentence. After one or two polls messages move to the dead-letter
  queue: a read-only connection mutates the queue beyond what the dialog stated.
- Suggested fix: on a read-only poll, stop at the first batch that contains any already-seen
  message (each message then counts at most one receive per poll, matching the dialog text). For the
  confirm, fetch the redrive policy before the first poll (a `GetQueueAttributes` through the count
  path the tab already runs, or a small dedicated call) so the first dialog can name the limit.
  Visibility choice itself is parked as D2.

## Connections (P181)

### F2. `Service.Update` skips `Input.normalized()`: stale draft options persist in URI mode

- File: `apps/kira-studio/internal/connections/service.go:369-400` (Create normalizes at `:279`,
  Test at `:661`).
- Severity: medium.
- Summary: P181's plan (D2) normalizes at the top of Create, Update and Test: URI mode stores
  `Options = {}`, fields mode drops `URI`. Update never calls it. In URI mode `validateFields` (the
  secret-option refusal) does not run either, so any options the caller sends are stored verbatim in
  plaintext `options_json`.
- Failure scenario 1 (functional): edit a fields-mode Postgres connection with `sslmode=require`,
  flip to URI mode. `setMode('uri')` writes `?sslmode=require` into the URI and leaves `d.options`
  set. Save: Update stores `options_json = {"sslmode":"require"}`. Later the user deletes
  `?sslmode=require` from the URI. `resolve` merges stored options with the URI's query
  (`resolve.go` `mergeOptions`), so `sslmode=require` still applies with no visible trace. A stale
  options diff also marks `destinationUnchanged` false and forces a needless reconnect.
- Failure scenario 2 (secret at rest): any Update caller sending URI mode with
  `options: {"password": "…"}` writes that secret to `options_json` unencrypted, the exact leak path
  2 P181 set out to close.
- Suggested fix: `in = in.normalized()` as Update's first line, before `Validate`. Add the case to
  the existing `TestURIModeUpdateRules`.

## Kira Space storage (P177)

### F4. Migration 0016 is never applied: not registered in `embed.go`

- File: `apps/kira-space/internal/storage/migrations/embed.go:17-34`;
  `apps/kira-space/internal/storage/migrations/0016_p177_ade_logs_purge.sql`.
- Severity: medium.
- Summary: `LoadMigrations` reads only the explicit `names` list; the `//go:embed *.sql` glob alone
  does not apply a file. The list stops at version 15. The P177 plan (lines 186-189) required the
  `{Version: 16, …}` entry. `docs/ARCHITECTURE.md:3835` states `0016` exists.
- Failure scenario: `ade_logs_task` and partial `ade_tasks_archived` are never created. The hourly
  `PurgeArchived` (`repos/adelogs.go`) runs its `EXISTS` subquery and its per-task
  `DELETE FROM ade_logs WHERE task_id = ?` as full scans of `ade_logs`, once per archived task, every
  hour. Purge stays correct, only slower, and the doc claim is false. A later phase adding its own
  "0016" would collide with the orphan file.
- Suggested fix: append `{Version: 16, Name: "p177_ade_logs_purge", File:
  "0016_p177_ade_logs_purge.sql"}` to `names`. Consider a guard test that every embedded `*.sql` is
  listed (a set comparison, cheap and it catches exactly this).

## Credential relay (P178)

### F5. Two prompts raised with no window open can open the window twice

- File: `apps/kira-space/main.go:457-467`; `apps/kira-space/internal/gitcred/relay.go:96-101`.
- Severity: low.
- Summary: `Relay.Ask` calls `onAdded` outside the relay lock, from each asking goroutine.
  `surfaceCredentialPrompts` checks `windows.Count() == 0` then calls `shell.ReopenWindows`, which
  has no single-flight. `OpenWindow` registers via `Windows.Add` keyed by record key, with no dedupe.
- Failure scenario: Kira Space running windowless; VS Code fetches two repos that both need
  credentials at once (or ADE plus VS Code). Both callbacks see zero windows, both call
  `ReopenWindows` with the same stored record: two native windows for one key, the registry keeps
  only the second, the first's `detach` leaks.
- Suggested fix: serialize the callback (a mutex in `surfaceCredentialPrompts` around the
  count-then-open), so the second call sees the first window and only focuses it.

## API client (P175)

### F6. gRPC schema cache key ignores variable values, so a schema can outlive the host it came from

- File: `apps/kira-studio/frontend/src/views/grpcrequest/schemaQuery.ts:57-76`, `:115-126`.
- Severity: low.
- Summary: the reflection key holds the raw `target` template plus collection/environment ids, with
  `staleTime: Infinity` and no invalidation on variable change. The comment says it mirrors Go's
  `cacheKey`, but `grpcclient/descriptors.go:215` hashes the resolved `src.Target`. Before P175 each
  tab re-described on mount, so Go's resolved-target cache decided.
- Failure scenario: target `{{host}}:443`, environment value `host=a`. Edit the environment so
  `host=b`. Every tab on that request (including new ones) keeps showing service a's schema until
  the user presses reload; sends go to b with a's message shapes.
- Suggested fix: invalidate `['grpcSchema', 'reflection']` queries on the `kira:api:dataChanged`
  variables change already handled by `initApiDataSync`, or include the resolved non-secret target in
  the key. Fix the comment either way.

## Documentation and comments

### F7. Stale comment: native-stream guard says the socket still accepts `WorktreeBasePath`

- File: `apps/kira-space/internal/bridge/gitstream.go:101-105`.
- Severity: low.
- Summary: since P178 `git.sock` refuses every `repoSettings.set` (`spaceOnlyMethods`), so the
  socket accepts no settings leaf at all. The comment justifies `guardRepoSettingsSet` with a
  fact that is no longer true.
- Failure scenario: a later reader removes or widens the guard reasoning from a false premise.
- Suggested fix: reword to "defence in depth; `git.sock` refuses `repoSettings.set` outright
  (P178)". Also wrap the over-long line.

## Tests against the unit-test bar

### F8. `gitcred/relay_test.go` keeps tests that restate short function bodies

- File: `apps/kira-space/internal/gitcred/relay_test.go:50` (`TestAnswerReachesAsk`), `:66`
  (`TestDismissalReturnsFalse`), `:102` (`TestDoubleProvideIsNoOp`), `:121`
  (`TestSnapshotOrderIsFIFO`), `:164` (`TestOnAddedFiresOncePerEntry`).
- Severity: low.
- Summary: CLAUDE.md's bar keeps tests only for genuinely hard logic. These five each restate a
  few-line branch of `Ask`/`Provide` or `PendingQueue`'s FIFO (already covered by `notify`).
  `TestCtxCancelWithdrawsAndEmits` and `TestConcurrentAsksAllResolve` guard real concurrency and stay.
- Failure scenario: none at runtime; maintenance cost and a precedent against the standing rule.
- Suggested fix: delete the five; keep the two concurrency tests.

## Smaller correctness items

### F9. Redis bounded scans honour only the row axis of the cap

- File: `apps/kira-studio/internal/adapters/redis/consolebound.go:167-245`.
- Severity: low.
- Summary: `runBoundedCommand` bounds by `limit.Rows` only; `runScan` accumulates every item of each
  `COUNT 1000` round into `out` before the page builder applies `Bytes`.
- Failure scenario: `HGETALL` on a hash of large values (say 10,000 fields x 1 MiB) fetches up to
  10,001 values (~10 GiB) before the 64 MiB byte cap trims the page. The P174 open item names `GET`
  of a huge string, not this rewritten form, which reads as "bounded".
- Suggested fix: track bytes in `runScan` (sum `formatReplyItem` lengths of emitted items) and stop
  once `limit.Bytes` is reached; or note the limit in the Known open item.

## Parked: DESIGN-DECISION, needs user input

### D1. Console byte budget: per statement or per batch

F1's fix needs a choice. Per batch keeps every response deliverable over one 64 MiB data frame but
lets an early statement starve later ones (later results show as empty-and-truncated). Per
statement keeps today's semantics but needs a lower per-statement budget (e.g. 64 MiB / statement
count) or a multi-frame response. Recommend per batch with the budget below the frame cap.

### D2. Read-only SQS visibility timeout

SQS has no peek. A 1 s timeout keeps messages visible to real consumers but forces dedupe and risks
multiple receives per poll (F3). A timeout equal to the poll's own duration (a few seconds) gives at
most one receive per message per poll but hides messages from consumers that long. User call on
which side read-only browse should favour; F3's "stop at first duplicate batch" fix is safe under
either choice.
