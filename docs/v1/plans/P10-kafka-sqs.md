# P10 — Kafka + SQS adapters + stream view

> Plan for SPEC.md §10 phase **P10**. Deliverable: *Adapters + stream view.* "Most divergent
> semantics; benefits from everything above" — read as license to lean hard on every precedent
> P1-P9 already established (page-kind union, caps-driven UI dispatch, ephemeral/pooled client
> patterns, read-only adapters) rather than inventing new machinery, since this phase's actual
> novelty is entirely in the two engines' semantics, not in the app's shape.

## 0. Ground rules for this phase

- Build exactly what §5.1's kafka/sqs rows + §8.9 "Stream view" + §5.1's SQS read-policy paragraph
  describe. No producer UI (no "publish a message" anywhere), no consumer-group management UI
  beyond a read-only listing, no Kafka Connect/Schema Registry integration, no SQS FIFO-specific UI,
  no DLQ redrive UI — none of these are named anywhere in scope for v1.
- §8.9's literal text: "Message list with key, headers, partition/offset (Kafka) or message/receipt
  attributes (SQS), body in the document/cell viewer. SQS is poll-on-demand only (§5.1)."
- §5.1's kafka row: tree = topics → partitions (browse only); default view = stream; pagination =
  offset window; exact count = end-begin (high/low watermark subtraction); cancel = stop consumer +
  `AbortSignal`; caps = `sql:no ddl:no foreignKeys:no`.
- §5.1's sqs row: tree = queues; default view = stream; pagination = batch (poll-on-demand, no
  addressable position); exact count = no, approximate only; cancel = SDK `AbortSignal`; caps =
  `sql:no ddl:no foreignKeys:no`.
- §5.1's SQS paragraph (verbatim): "Reads are never automatic... Authentication is by named AWS
  profile; static keys are accepted only in URI mode." Both halves are binding: the stream view must
  never auto-load on mount for a `'batch'`-strategy tab, and fields-mode SQS connections must not
  offer a static-secret-key field at all (profile only), while URI mode may carry static keys.
- Both adapters are read-only, same posture as Redis (P9): `caps.writable: false`;
  `preview()`/`mutate()` throw `E_UNSUPPORTED`. Neither engine has a query console (`caps.sql:
  false` for both — unlike Redis's shell-style console) since neither has a meaningful ad-hoc
  command surface named in scope; `describe()`/`ddl()` are unsupported stubs (`caps.ddl: false`).
- Driver deviation from SPEC.md §3: SPEC names `@confluentinc/kafka-javascript` for Kafka. This
  phase uses `kafkajs` instead — verified hands-on that `@confluentinc/kafka-javascript`'s native
  binding fails to load under Bun (`NODE_MODULE_VERSION 127` vs Bun's required `137`), and
  `package.json`'s `"test:db": "bun test tests/db"` is a hard, unchangeable project convention.
  `kafkajs` is pure JS (no native bindings) and was confirmed working identically under Bun and
  Node via a hands-on smoke test (topic create, produce, fetch offsets/metadata, list groups,
  consumer subscribe+run). SQS uses `@aws-sdk/client-sqs` exactly as named.
- Kafka's browse semantics are deliberately forward-only, starting from the low watermark (topic
  beginning): each `read()` call opens a short-lived, unique-`groupId` consumer that never commits
  offsets, seeks its assigned partitions to the requested offset(s), collects up to `pageSize`
  messages bounded by a watermark frozen at browse-start, then stops. Prev is always disabled
  (mirrors Redis's own SCAN-cursor precedent: `KeyValueView.vue` already disables Prev whenever
  `strategy !== 'offset'`). A tail-first/bidirectional design is explicitly out of scope for this
  phase.
- No unit tests beyond the two existing suites' pattern. `tests/db/kafka.spec.ts` and
  `tests/db/sqs.spec.ts` are new numbered-scenario files (mirror `redis.spec.ts`'s structure) using
  Testcontainers; `tests/ui/kafka.spec.ts` and `tests/ui/sqs.spec.ts` are new minimal-but-real UI
  specs. Kafka's Testcontainers fixture must use the `confluentinc/cp-kafka` image, not
  `apache/kafka` — verified hands-on that `@testcontainers/kafka`'s `KafkaContainer` module is
  hardcoded to Confluent's `KAFKA_*` env-var + entrypoint-script contract and silently produces a
  broker whose listener never opens under the plain Apache image. SQS's fixture uses
  `@testcontainers/localstack` (no official AWS-SQS-specific Testcontainers image exists). Run
  `bun run lint`, `bun run typecheck` (all three project splits), `bunx electron-vite build`,
  `bun run test:db`, and `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`Page` is a three-member union with a doc comment reserving this exact widening** —
   `src/shared/protocol/page.ts`: `type Page = TabularPage | DocumentPage | KeyValuePage; // P10
   adds StreamPage`. `assertPageStructure()` already dispatches on `page.kind` with 2 explicit arms
   plus a keyvalue fallthrough; this phase adds a genuine 4th arm.
2. **`Caps`/`PageKind`/`PaginationStrategy` already have the target literals reserved** —
   `src/shared/caps.ts`'s `PaginationStrategy` TS type and its zod schema already include
   `'offsetWindow'` and `'batch'` as literals, and the file's bottom doc-comment table already fully
   specifies both engines' cap field values as documentation (kafka: `stream | offsetWindow | yes
   (end-begin) | stop consumer + AbortSignal | sql:no ddl:no foreignKeys:no`; sqs: `stream | batch |
   no (approx) | SDK AbortSignal | no/no/no`) — this phase turns that table into real code, nothing
   more. `PageKind` already includes `'stream'`. `PagePosition.strategy` in
   `src/shared/protocol/page.ts` is a separate, narrower zod enum (`z.enum(['keyset', 'offset',
   'cursor'])`) that still needs manual widening to add `'offsetWindow'` and `'batch'`.
3. **`tabKindSchema` already includes `'stream'`**; `RENDERABLE_TAB_KINDS` and `tabRecordSchema`'s
   discriminated union do not yet have the matching member — this phase adds
   `streamTabStateSchema`/`defaultStreamTabState()`/`asStreamTab()` following the
   `keyValueTabStateSchema` pattern (P9), plus one SQS-specific field (D9 below).
4. **`connectionKindSchema` already includes `'kafka'` and `'sqs'`**, added ahead of time in an
   earlier phase and unused until now. `DEFAULT_PORT` has no entries for either. `nodeKindSchema`
   has no Kafka/SQS-appropriate literals at all (unlike P9, which reused Mongo's `'database'`
   literal outright) — new literals must be added fresh (D3 below).
5. **`connectionInputSchema`'s `superRefine` (`src/shared/domain/connection.ts`) unconditionally
   requires `host`+`port` in fields mode** — a real blocker for SQS, whose fields mode repurposes
   `database`(region)/`username`(profile) and leaves `host`/`port` unused (D8 below); this phase
   adds a per-kind exception.
6. **`src/shared/domain/uri.ts` is fully generic/kind-agnostic** (plain `new URL(uri)` parsing under
   the hood, confirmed by reading the file in full) — a new `sqs://accessKeyId:secretAccessKey@region`
   URI scheme works with zero changes to this file.
7. **`registry.ts` is a flat object literal** — adding both adapters is two imports + two entries,
   same as every prior phase.
8. **`engine/data.ts`, `engine/cache/{index,pages}.ts`, `renderer/bridge/data.ts` are already fully
   `Page`-generic** (confirmed by reading all four in P9 and re-confirmed unchanged this phase) — no
   changes needed.
9. **`Adapter.read()`/`OpCtx` already fit Kafka's ephemeral-consumer design with zero scheduler
   changes** — `scheduler/ops.ts` aborts `ctx.signal` before calling `adapter.cancel(opId)` (same
   ordering P9's D7/D15 relied on), so registering `ctx.signal.addEventListener('abort', () =>
   consumer.stop())` directly inside `read()` satisfies the spec's literal Kafka cancel mechanism
   without any changes to `engine/scheduler/`; `adapter.cancel(opId)` stays a permanent no-op
   returning `false`, mirroring P9's D7/D8 exactly. SQS's cancel is even simpler: the AWS SDK v3
   command call itself accepts an `abortSignal` request option, so `ctx.signal` is passed straight
   through with no bridging needed.
10. **`ConnectionSet`'s LRU-`Map` pooling pattern (`mariadb/client.ts`) does not apply to either
    engine** — Kafka's browse consumers are intentionally ephemeral (one per `read()` call, never
    reused, per the ground rules above), and SQS has no persistent connection concept at all (each
    SDK call is an independent HTTPS request via `SQSClient`, which is cheap to construct and does
    not need pooling). Both adapters instead keep one long-lived "admin" handle (a kafkajs `Admin`
    client for topic/group listing and watermark queries; an `SQSClient` instance for queue listing
    and per-call receive/attribute requests) constructed once in `connect()`.
11. **`views/keyvalue/state.ts`'s dual cursor-token-vs-plain-offset pagination pattern is the direct
    template** for Kafka's offset-window paging (`nextToken` carries the frozen high watermark plus
    the next-offset-to-read, base64url-encoded like every other token in this codebase) — read in
    full this phase. **`views/keyvalue/kvPage.ts`'s per-tab reactive page store with a decode cache**
    is the direct template for `views/stream/streamPage.ts`. **`views/keyvalue/keyValueMenu.ts`'s
    minimal copy-only row menu** is the direct template for `views/stream/streamMenu.ts`.
12. **`KeyValueView.vue`'s self-contained-toolbar precedent (`Toolbar.vue`'s excluded-kinds check)**
    applies identically to `StreamView.vue` — one more excluded kind, no other change.
13. **Neither `@confluentinc/kafka-javascript` nor `@aws-sdk/credential-providers` is a dependency
    yet**; `package.json` currently has `kafkajs` (already added, replacing the deviated-from
    driver) and `@aws-sdk/client-sqs` (already added) as dependencies, and `@testcontainers/kafka` +
    `@testcontainers/localstack` (already added) as devDependencies. This phase adds
    `@aws-sdk/credential-providers` (for `fromIni`, real-world named-profile resolution) as a new
    dependency.
14. **`ProjectTree.vue`'s open-dispatch is a branching `Set`-per-kind dispatch** (P8/P9 precedent) —
    this phase adds `'topic'` and `'queue'` to a new `STREAM_OPENABLE_KINDS` set calling
    `openStreamTab`; `'consumerGroup'` (Kafka-only, read-only informational leaf) stays non-openable,
    childless, with only a copy-name menu entry.

## 1. Shapes introduced in this plan

```ts
// src/shared/protocol/page.ts

// One row per message/record. All five fields reuse TextColumnChunk (mirrors KeyValuePage's and
// DocumentPage's fixed-named-column reuse) rather than TabularPage's caller-supplied columns[] —
// projection:false means there is no "which columns" question for a stream. `attrs` is the one
// column whose *meaning* differs per engine (partition/offset JSON for Kafka, SQS system
// attributes JSON for SQS) per §8.9's literal "X (Kafka) or Y (SQS)" phrasing; `keys` is the Kafka
// message key or the SQS MessageId; `headers` is JSON-stringified Kafka record headers or SQS
// MessageAttributes.
export interface StreamPage {
  kind: 'stream';
  position: PagePosition;
  keys: TextColumnChunk;
  headers: TextColumnChunk;
  attrs: TextColumnChunk;
  timestamps: TextColumnChunk; // ISO-8601 text, nullable per row
  bodies: TextColumnChunk;
  rowCount: number;
  byteSize: number;
  visibilityTimeoutSeconds: number | null; // SQS only; null for Kafka (mirrors KeyValuePage's
                                            // whole-object-metadata-on-the-page precedent)
}

export type Page = TabularPage | DocumentPage | KeyValuePage | StreamPage;

export function createStreamPageBuilder(opts: {
  visibilityTimeoutSeconds: number | null;
}): {
  push(row: { key: string | null; headers: string; attrs: string; timestamp: string | null; body: string }): void;
  build(position: PagePosition): StreamPage;
};

// assertPageStructure gains a 4th, genuine `page.kind === 'stream'` arm (replacing the current
// keyvalue-fallthrough-only structure), validating all five TextColumnChunks the same way the
// document/keyvalue arms validate their own fixed columns.
export function assertPageStructure(page: Page): void;

// PagePosition.strategy widens: z.enum(['keyset', 'offset', 'cursor', 'offsetWindow', 'batch']).
// 'offsetWindow' (Kafka): nextToken carries {highWatermark, nextOffset} per partition, base64url-
// encoded. 'batch' (SQS): hasMore/nextToken/prevToken are always false/null/null — every poll is
// an independent, non-resumable request.
```

```ts
// src/engine/adapters/kafka/caps.ts
export const kafkaCaps: Caps = {
  tree: { levels: ['topic', 'partition'], leafHasChildren: false },
  defaultView: 'stream',
  pagination: 'offsetWindow',
  count: 'exact', // high watermark - low watermark, per partition, summed
  cancel: true,
  writable: false,
  sql: false,
  ddl: false,
  foreignKeys: false,
};
```

```ts
// src/engine/adapters/sqs/caps.ts
export const sqsCaps: Caps = {
  tree: { levels: ['queue'], leafHasChildren: false },
  defaultView: 'stream',
  pagination: 'batch',
  count: 'estimate-only', // ApproximateNumberOfMessages
  cancel: true,
  writable: false,
  sql: false,
  ddl: false,
  foreignKeys: false,
};
```

```ts
// src/engine/adapters/kafka/client.ts
// One long-lived kafkajs Admin client per adapter instance, constructed in connect(). Browse
// consumers (read.ts) are separate, ephemeral, and never touch this handle.
export function connectKafka(cfg: ResolvedConnectionConfig): Promise<{
  kafka: Kafka; // kafkajs client factory, kept to construct ephemeral consumers later
  admin: Admin;
}>;
```

```ts
// src/engine/adapters/sqs/client.ts
// Resolves credentials per D8: fields mode -> fromIni({ profile: cfg.username }) with cfg.database
// as the region; URI mode -> static keys from the URI if present, else default provider chain;
// options.endpoint (either mode) overrides the endpoint (LocalStack / non-AWS-compatible target).
export function connectSqs(cfg: ResolvedConnectionConfig): Promise<{ client: SQSClient }>;
```

```ts
// src/engine/adapters/kafka/errors.ts
export function mapKafkaError(err: unknown): AdapterError;
// src/engine/adapters/sqs/errors.ts
export function mapSqsError(err: unknown): AdapterError;
```

```ts
// src/engine/adapters/kafka/catalog.ts
// listTopics: admin.fetchTopicMetadata() -> one 'topic' node per non-internal topic (filters the
// '__'-prefixed internal topics, e.g. __consumer_offsets).
export function listTopics(admin: Admin): Promise<TreeNode[]>;
// listPartitions: metadata.partitions.length -> one 'partition' node per partition index, under a
// topic (browse-only leaves, not directly openable — the topic itself opens the stream tab, per
// D4 below, mirroring how a redis 'database' opens nothing and only its 'key' leaves are openable).
export function listPartitions(admin: Admin, topic: string): Promise<TreeNode[]>;
```

```ts
// src/engine/adapters/sqs/catalog.ts
// listQueues: paginated ListQueuesCommand -> one 'queue' node per queue URL, name = the URL's last
// path segment.
export function listQueues(client: SQSClient): Promise<TreeNode[]>;
```

```ts
// src/engine/adapters/kafka/read.ts
// Ephemeral-consumer offset-window browse (ground rules above). Opens a new consumer with a random
// groupId, subscribes to `topic` from the requested partition-offset map, freezes the high
// watermark on first page of a browse, runs eachBatch collecting up to req.pageSize messages total
// across assigned partitions, stops+disconnects before returning. ctx.signal abort -> consumer.stop().
export function readTopic(kafka: Kafka, topic: string, req: ReadRequest, ctx: OpCtx): Promise<StreamPage>;
// countTopic: admin.fetchTopicOffsets(topic) -> sum(high - low) across partitions. exact: true.
export function countTopic(admin: Admin, topic: string, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
```

```ts
// src/engine/adapters/sqs/read.ts
// pollQueue: loops ReceiveMessageCommand (MaxNumberOfMessages capped at 10 per call, the SDK's hard
// per-call limit) up to ceil(req.pageSize / 10) times, stopping early on any empty/partial batch.
// One GetQueueAttributesCommand(['ApproximateNumberOfMessages', 'VisibilityTimeout']) call per poll
// feeds both countQueue() and the page's visibilityTimeoutSeconds field. ctx.signal passed as the
// SDK command's abortSignal request option (no bridging needed, per reality #9).
export function pollQueue(client: SQSClient, queueUrl: string, req: ReadRequest, ctx: OpCtx): Promise<StreamPage>;
export function countQueue(client: SQSClient, queueUrl: string, ctx: OpCtx): Promise<{ value: number; exact: boolean }>;
```

```ts
// src/engine/adapters/kafka/index.ts
export function createKafkaAdapter(deps: AdapterDeps): Adapter;
// describe()/ddl()/preview()/mutate() all throw AdapterError('E_UNSUPPORTED', ...). cancel(opId) is
// a permanent no-op returning false (mirrors P9's D7/D8) — ctx.signal is the sole mechanism.

// src/engine/adapters/sqs/index.ts
export function createSqsAdapter(deps: AdapterDeps): Adapter;
// Same unsupported stubs. cancel(opId) is also a permanent no-op returning false — the SDK's own
// abortSignal plumbing (reality #9) is the sole mechanism, same shape as Kafka's for consistency
// even though the underlying wiring differs.
```

```ts
// src/shared/domain/tabs.ts
export interface StreamTabState {
  status: 'idle' | 'loading' | 'error';
  error: string | null;
  polled: boolean; // SQS only; false until the user's first explicit Poll click (D10) — Kafka
                    // tabs are created with this already true, since Kafka auto-loads normally.
}
export function defaultStreamTabState(kind: 'kafka' | 'sqs'): StreamTabState;
export function asStreamTab(tab: TabRecord): StreamTabRecord | null;
```

```ts
// src/renderer/state/tabs.ts
export function openStreamTab(connectionId: string, path: string, opts?: { newTab?: boolean }): string;
export function patchStreamTabState(tabId: string, patch: Partial<StreamTabState>): void;
export function findStreamTab(connectionId: string, path: string): TabRecord | undefined;
```

```ts
// src/renderer/views/stream/state.ts — mirrors views/keyvalue/state.ts's runtime shape. load()
// checks caps.pagination: 'offsetWindow' behaves exactly like every other auto-loading view;
// 'batch' is only ever invoked from an explicit poll(tabId) call, never from onMounted.
export function load(tabId: string, opts?: { refresh?: boolean }): Promise<void>;
export function poll(tabId: string): Promise<void>; // SQS-only entry point; also sets polled: true
export function goNext(tabId: string): Promise<void>; // no-op / hidden pager for 'batch' strategy
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | `StreamPage` reuses `TextColumnChunk` as 5 fixed named columns (`keys`/`headers`/`attrs`/`timestamps`/`bodies`) plus a page-level `visibilityTimeoutSeconds`, rather than `TabularPage`'s caller-supplied `columns[]`. | Mirrors `KeyValuePage`/`DocumentPage`'s precedent (realities #1, P9's D1): a stream row's shape is fixed by the engine, not by a projection the caller chooses, so there is no "which columns" question `TabularPage`'s generic shape exists to answer. |
| D2 | One shared `StreamView.vue` renders both Kafka and SQS tabs, since both share the `'stream'` page kind; behavior differences (auto-load vs. poll-button, Next-only vs. hidden pager) are gated on `caps.pagination`, never on connection kind directly. | Preserves the app's stated "UI picks a view from the page kind [and caps], never from the database kind" philosophy — the same principle `KeyValueView.vue` already follows for its per-`redisType` row rendering. |
| D3 | `nodeKindSchema` gains four fresh literals: `'topic'`, `'partition'`, `'consumerGroup'`, `'queue'`. `'topic'` and `'consumerGroup'` are **root-level siblings** (both direct children of the connection root), not nested — matches `caps.ts`'s own doc-comment table ("cluster → topics, consumer groups"), and correctly reflects that a group can span many topics or none of the ones currently browsed, so nesting it under one topic would misrepresent it. `'partition'` nests under its `'topic'`. | Unlike P9, no existing literal fits (Kafka's topic/partition/group and SQS's flat queue list have no semantic overlap with any tabular/document/keyvalue tree level already named) — reality #4. |
| D4 | `'topic'` and `'queue'` are the openable leaves (open a `'stream'` tab); `'partition'` and `'consumerGroup'` are browse-only, non-openable, childless tree nodes with only a copy-name menu entry (no per-group message browsing in scope). | A topic's stream view already browses across all its partitions by default (D5 below) — a single partition is metadata to inspect in the tree, not a separately-openable unit, matching how a redis `'namespace'` is browsable structure but only a `'key'` leaf opens a tab (P9 precedent); a consumer group is purely informational (membership/state), with no message-level view named in scope for it. |
| D5 | Kafka's `read()` browses across **all partitions of a topic** in one call (not a per-partition read), merging messages from every assigned partition into one page ordered by (partition, offset) for determinism. | §8.9 names a single "message list" per topic, not a per-partition view; a per-partition-only read would force the user to browse N separate tabs to see one topic's traffic, which nothing in scope asks for. |
| D6 | Kafka's ephemeral-consumer design (ground rules): a new consumer with a random `groupId` is created per `read()` call, never commits offsets, seeks explicitly, stops after collecting one page, and is discarded. `adapter.cancel(opId)` is a permanent no-op returning `false`; cancellation is `ctx.signal.addEventListener('abort', () => consumer.stop())` registered inside `read()` itself. | Fits the existing single-request `Adapter.read()`/`OpCtx` shape with zero `engine/scheduler/` changes (reality #9) — the alternative (one long-lived subscribed consumer per topic, kept alive across page requests) would need genuinely new scheduler-level lifecycle management the phasing table's "benefits from everything above" framing gives no indication this phase should introduce. Never committing offsets means browsing a topic leaves no trace in `__consumer_offsets` and never interferes with real consumer groups. |
| D7 | Kafka browsing is forward-only from the low watermark; Prev is always disabled (`prevDisabled` gated the same way `KeyValueView.vue` already gates it for `strategy !== 'offset'`, reused verbatim for `'offsetWindow'`). A tail-first or bidirectional design is out of scope. | Matches Redis's own SCAN-cursor precedent (P9) of a forward-only cursor strategy; a bidirectional design would require tracking and re-seeking to prior-page start offsets per partition, adding real complexity for a capability nothing in §8.9/§5.1 asks for. |
| D8 | SQS fields mode repurposes `database` for the AWS region and `username` for the AWS named profile, per §5.1's literal "Authentication is by named AWS profile" wording; `host`/`port`/`password` stay unused, requiring a per-kind exception in `connectionInputSchema`'s `superRefine`. URI mode uses `sqs://accessKeyId:secretAccessKey@region` (zero changes needed to `uri.ts`, reality #6). A custom endpoint override (required for LocalStack testing, and legitimate for any SQS-compatible non-AWS endpoint) reads from the existing free-form `options.endpoint` field. | Mirrors the S3 field-repurposing precedent SPEC.md §6 already documents for a not-yet-built adapter ("named profile in username, options_json for bucket/region/prefix, uri for static keys") — reusing an established pattern rather than inventing a new one, and satisfying §5.1's literal ban on a static-secret-key field in fields mode while still allowing it in URI mode as the same paragraph explicitly permits. |
| D9 | `@aws-sdk/credential-providers`' `fromIni({ profile })` resolves fields-mode credentials from the local `~/.aws/credentials` file; URI-mode static keys are passed directly to `SQSClient`'s `credentials` option; when neither applies, the SDK's default provider chain is used. | The only way to honor "Authentication is by named AWS profile" (D8) for a real named profile is `fromIni` — the SDK's default chain alone does not let a user pick a *specific* named profile by name. |
| D10 | Kafka tabs auto-load on mount exactly like every other view (`caps.pagination === 'offsetWindow'`); SQS tabs never auto-load (`caps.pagination === 'batch'`) — `StreamTabState.polled` starts `false` for SQS and the view shows an explicit "Poll" button plus a visibility-timeout warning banner (populated from the page's `visibilityTimeoutSeconds`, refreshed each poll) until the first poll. A fresh Poll click **replaces** the currently displayed message list, it does not append. | Directly implements §5.1's "Reads are never automatic" for SQS while leaving Kafka's UX unaffected (nothing in spec says Kafka reads should not auto-load, and §8.9's "poll-on-demand only" clause is scoped explicitly to SQS by its own parenthetical). Replacing rather than appending matches SQS's "batch" pagination semantics (D11): each poll is an independent, non-resumable snapshot with no relationship to the previous one, so appending would misleadingly imply continuity that does not exist. |
| D11 | SQS pagination is `'batch'`: `PagePosition.hasMore`/`nextToken`/`prevToken` are always `false`/`null`/`null`. The Next/Prev pager UI is hidden entirely (not merely disabled) for a `'batch'`-strategy stream tab. | SQS's `ReceiveMessageCommand` has no addressable position at all — there is no cursor or offset to resume from, only "ask again and maybe get different messages" — so a pager control would imply a capability that does not exist; hiding it (rather than showing disabled buttons, as Kafka's Prev does) avoids implying a "there might be a previous page" that SQS fundamentally cannot have. |
| D12 | SQS's hard per-call `MaxNumberOfMessages` cap of 10 is satisfied by looping up to `ceil(pageSize / 10)` `ReceiveMessageCommand` calls per poll, stopping early on any empty or partial batch. | The AWS API enforces this cap server-side; honoring a larger UI-requested page size requires multiple calls, and stopping early on a short batch avoids unnecessary additional round-trips once the queue is plausibly drained for that poll. |
| D13 | Neither adapter implements a console (`caps.sql: false` for both), unlike Redis's shell-style console. | Neither engine has an ad-hoc command surface named anywhere in scope (§8.14 only names SQL-family/redis-shell consoles); inventing one would be new surface area the phasing table gives no indication this phase should add. |
| D14 | Both adapters' `cancel(opId)` are permanent no-ops returning `false`; `caps.cancel: true` for both regardless. | Mirrors P9's D7/D8 exactly: for Kafka, the signal-bridged `consumer.stop()` registered inside `read()` is already fully effective (D6); for SQS, the SDK's own `abortSignal` request-option plumbing is already fully effective (reality #9) — in both cases the capability is honestly `true` because the *mechanism* (not the `cancel()` method itself) works. |
| D15 | `kafkajs` replaces SPEC.md §3's named `@confluentinc/kafka-javascript` driver; `@testcontainers/kafka`'s Testcontainers fixture must be constructed with the `confluentinc/cp-kafka:7.6.1` image, not `apache/kafka`. | Both are verified, hands-on-confirmed environment realities, not preferences: `@confluentinc/kafka-javascript`'s native binding fails to load under Bun's ABI (127 vs required 137), and `@testcontainers/kafka`'s `KafkaContainer` module is hardcoded to Confluent's `KAFKA_*`-env-var + entrypoint-script contract, silently producing a broker whose listener never opens under the plain Apache image. Both were caught via hands-on smoke tests before any fixture/adapter code was written against the broken assumption. |
| D16 | `nodeKindSchema`'s new literals sort Kafka's tree as `topic` → (`partition`, `consumerGroup`) and SQS's as a flat `queue` list with no deeper level. | Matches §5.1's tree column exactly ("topics -> partitions (browse only)" for Kafka; "queues" for SQS) — no invented intermediate levels. |
| D17 | `ioredis`-style connection pooling (`ConnectionSet`/`DbConnectionSet`) is deliberately not used by either adapter; each keeps one long-lived admin/client handle from `connect()` plus fully ephemeral per-call browse state. | Neither engine has MariaDB/Redis's "connection-wide mutable state" problem (`USE`/`SELECT`) that pooling exists to solve — Kafka's browse consumers are intentionally single-use by design (D6), and SQS's `SQSClient` calls are independent stateless HTTPS requests that need no session affinity at all. |
| D18 | `@aws-sdk/credential-providers` is added as a new dependency (fields-mode named-profile resolution, D9); no equivalent new dependency is needed for Kafka beyond `kafkajs` itself. | `@aws-sdk/client-sqs` alone does not expose `fromIni`; `kafkajs`'s SASL/plaintext broker connection needs no additional package. |

## 3. Target tree at the end of P10

```
src/shared/
  protocol/page.ts        MOD — StreamPage, createStreamPageBuilder, Page union widened to 4
                                 members, assertPageStructure 4th arm, PagePosition.strategy gains
                                 'offsetWindow', 'batch'.
  caps.ts                  MOD — kafka/sqs rows in the Caps doc-comment table turn into real usage
                                  (kafkaCaps/sqsCaps consume the already-declared literals).
  domain/tree.ts           MOD — nodeKindSchema gains 'topic', 'partition', 'consumerGroup', 'queue'.
  domain/tabs.ts           MOD — streamTabStateSchema, defaultStreamTabState, asStreamTab,
                                  tabRecordSchema stream member, RENDERABLE_TAB_KINDS.
  domain/connection.ts     MOD — DEFAULT_PORT.kafka = 9092; superRefine relaxes host/port
                                  requirement for 'sqs' in fields mode.
src/engine/adapters/
  registry.ts               MOD — kafka: createKafkaAdapter, sqs: createSqsAdapter entries.
  kafka/                    NEW
    caps.ts                 NEW — kafkaCaps.
    client.ts                NEW — connectKafka (Kafka client + long-lived Admin handle).
    errors.ts                 NEW — mapKafkaError → AdapterError.
    catalog.ts                  NEW — listTopics, listPartitions.
    read.ts                       NEW — readTopic (ephemeral-consumer offset-window browse),
                                        countTopic (watermark subtraction).
    index.ts                        NEW — createKafkaAdapter (no-op cancel, no console/ddl).
  sqs/                      NEW
    caps.ts                 NEW — sqsCaps.
    client.ts                 NEW — connectSqs (SQSClient construction: profile/static-key/
                                     endpoint-override handling).
    errors.ts                   NEW — mapSqsError → AdapterError.
    catalog.ts                    NEW — listQueues.
    read.ts                         NEW — pollQueue (looped ReceiveMessage batching +
                                          GetQueueAttributes), countQueue.
    index.ts                          NEW — createSqsAdapter (no-op cancel, no console/ddl).
src/renderer/
  state/tabs.ts             MOD — openStreamTab, patchStreamTabState, findStreamTab,
                                    duplicateTab's 6th (stream) branch.
  project/ConnectionDialog.vue MOD — SUPPORTED_KINDS gains 'kafka', 'sqs'; conditional field
                                       visibility (SQS: region/profile/endpoint, no static-key field
                                       in fields mode per D8; Kafka: host/port/optional SASL
                                       username+password).
  project/ProjectTree.vue   MOD — STREAM_OPENABLE_KINDS ('topic', 'queue') → openStreamTab;
                                    'partition'/'consumerGroup' stay non-openable.
  project/menus.ts          MOD — 'topic'/'partition'/'consumerGroup'/'queue' cases (copy name/
                                    qualified name; 'topic'/'queue' also get an 'open' entry).
  workbench/panels/MainView.vue  MOD — v-else-if branch for 'stream' → StreamView.
  workbench/panels/Toolbar.vue   MOD — excluded-kinds check gains 'stream'.
  workbench/panels/TabStrip.vue  MOD — iconFor 'stream' case.
  project/icons.ts            MOD — icons for 'topic'/'partition'/'consumerGroup'/'queue'.
  views/console/resultPages.ts   MOD — 4th Page-kind branch (stream pages are not routed through
                                        the console, but assertPageStructure/shared page utilities
                                        must exhaustively handle the 4th member).
  views/stream/              NEW
    StreamView.vue            NEW — self-contained toolbar; auto-load vs. Poll-button + visibility-
                                     timeout banner gated on caps.pagination; Next-only pager for
                                     'offsetWindow', hidden pager for 'batch'.
    state.ts                   NEW — load()/poll()/goNext(), mirrors views/keyvalue/state.ts.
    streamPage.ts                 NEW — per-tab reactive page store + decode cache, mirrors
                                        views/keyvalue/kvPage.ts.
    streamMenu.ts                    NEW — minimal per-row context menu (copy key/body only).
package.json               MOD — kafkajs, @aws-sdk/client-sqs (both already added),
                                   @aws-sdk/credential-providers (new), @testcontainers/kafka,
                                   @testcontainers/localstack (both already added, devDependencies).
tests/db/
  support/kafka.ts          NEW — Testcontainers startKafka() using confluentinc/cp-kafka:7.6.1,
                                    mirrors support/redis.ts.
  support/sqs.ts             NEW — Testcontainers startSqs() using localstack/localstack:3.
  fixtures/0005_kafka_seed.ts NEW — seed topic(s) with representative messages across partitions.
  fixtures/0006_sqs_seed.ts    NEW — seed queue(s) with representative messages.
  kafka.spec.ts                 NEW — numbered scenario suite (catalog/tree, offset-window
                                      read/count, cancel).
  sqs.spec.ts                     NEW — numbered scenario suite (catalog/tree, batch poll/count,
                                        cancel).
tests/ui/
  support/kafka.ts           NEW — re-export wrapper, mirrors ui/support/redis.ts.
  support/sqs.ts               NEW — re-export wrapper.
  kafka.spec.ts                  NEW — connect, tree walk, open topic's stream tab, auto-load,
                                       consoleErrors check.
  sqs.spec.ts                      NEW — connect, tree walk, open queue's stream tab, assert no
                                         auto-load, Poll button click, consoleErrors check.
docs/plans/
  P10-kafka-sqs.md            NEW — this document.
```
