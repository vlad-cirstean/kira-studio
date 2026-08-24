# P32 — The Kafka adapter moves to `@confluentinc/kafka-javascript`, and stops joining a consumer group

> **SPEC.md §10, the P32 row, verbatim:** *"Migrate the Kafka adapter off its current client library
> onto `@confluentinc/kafka-javascript` (Kafka 4-compatible), and stop joining a consumer group for
> operations that don't need one — browsing/read-only paths currently pay a group-join round trip
> they have no use for."* (`docs/v1/SPEC.md:695`)
>
> **The user's own words:** *"Kafka 4 -> @confluentinc/kafka-javascript and Skip the group-join"*
>
> **Why these two are one phase and not two.** They are the same defect seen from two sides. The one
> place the adapter joins a consumer group is `read.ts:158-168` — a fresh unique-`groupId` consumer,
> `subscribe()`, `run()`, `seek()` — and the group-join path is *precisely* the path that breaks
> against a Kafka 4 broker (F8). Migrating the client without removing the group-join would mean
> porting the exact code that has no future; removing the group-join without migrating means
> rewriting `read.ts` against a library that cannot express manual assignment at all (F12).
> `read.ts` gets rewritten once, or twice.
>
> **What this phase is.** An engine-only swap inside `src/engine/adapters/kafka/` (7 files,
> 888 lines) plus the packaging and test-fixture work that a *native* production dependency forces
> on a repo that has never had one (`electron-builder.yml:17`, `docs/v1/PACKAGING.md:42-43`). Every
> capability in `caps.ts` stays true, every wire shape (`StreamPage`, `KafkaStreamFilter`, the
> offset-window page token) is unchanged, and no renderer file is touched.
>
> **The two facts that shape everything else, both verified here rather than assumed.** (1) The new
> client exposes **no `DescribeConfigs` and no `describeCluster`** on either of its two API surfaces
> (F11), so a topic's Configuration section and the connection's cluster id have no replacement —
> D13/D14 say what happens instead, out loud. (2) **Bun cannot load this addon at any ABI** (F21):
> given the *matching* prebuild it dies on an undefined `v8::FunctionTemplate::SetClassName`. That
> retires P10's D15 for good and moves the Kafka adapter suite off `bun test` onto the Electron
> runtime the shipped engine already uses (D27) — the largest structural change in the phase, and
> the one the ask did not name.
>
> **What this phase is not.** It is not an SQS change — SQS shares only `StreamPage` and the stream
> view with Kafka, uses `@aws-sdk/client-sqs`, and `sqs/read.ts` never looks at `filter`
> (`src/shared/domain/streamFilter.ts:5-8`). It is not a feature phase: no new browse mode, no tail
> browsing, no group-offset editing. And it is not P23's undoing — the topic/consumer-group
> definition tabs stay, with one honest, documented loss (D14).

## 0. Ground rules for this phase

- **One driver, not two.** `kafkajs` leaves `dependencies` in the same commit the new client lands.
  A "keep kafkajs for the one call the new client lacks" compromise is exactly the half-implementation
  AGENTS.md forbids, and it would keep a broken-on-Kafka-4 protocol implementation in the shipped
  bundle.
- **No capability may quietly become a lie.** `caps.ts` is a contract (§5). Anything this migration
  cannot deliver either keeps working by another route, or `caps`/`notes` change to say so in the
  same commit (D14, D16).
- **The adapter still imports nothing from `electron`** (`adapter.ts:34-36`). A native `.node` binary
  does not change that — it changes *which ABI the process loading the adapter must have*, which is
  a packaging and test-runner concern, handled in §3 Topic A, never with an `electron` import.
- **The verified-vs-assumed line is drawn explicitly.** Everything in §1 marked *verified* was read
  out of this repo, out of the published `@confluentinc/kafka-javascript@1.10.0` tarball, or probed
  over the network from this container, and says which. Everything that needs a live broker or a
  macOS box is marked *must be confirmed during implementation* and has a named step that confirms
  it. `bun run test:db` and `xvfb-run -a bun run test:ui` **cannot be run in Claude Code's Linux web
  container** — Docker Hub's blob CDN is blocked there (`AGENTS.md:43-48`), so no testcontainer ever
  starts. This phase additionally cannot even *build* the native module there (F20).
- **Cancellation stays real.** §5's rule — *"Cancellation is never 'stop showing the result'"* —
  and `adapter.ts:37-38`. The mechanism changes shape (D22); it does not weaken.
- **Comments per AGENTS.md:** only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint (a required-but-unused `group.id`, an ABI marker, an offset
  numeric range) gets exactly one line at its implementation site.
- **The test runner bends around the driver, not the other way round.** Bun cannot load this
  native module at all (F21, probed to a conclusion), so the Kafka adapter suite moves to a runtime
  that can (D27) rather than being thinned, skipped, or left to a "works on my machine" note.
- Run `bun run lint`, `bun run typecheck` (every project) and `bun run build` on every step.
  `bun run test:db`, `bun run test:db:kafka` and `bun run test:ui` on the macOS/Colima box before
  the phase is called done.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings (verified against the tree, the published package, and the network — not assumed)

### The adapter as it stands

**F1 — the whole Kafka driver surface is 7 files and every one of them imports `kafkajs`.**
`client.ts:1-2` (`Kafka`, `logLevel`, `Admin`), `index.ts:1`, `read.ts:1` (`Admin`, `IHeaders`,
`Kafka`), `catalog.ts:1`, `definition.ts:1-6` (`Admin`, `ConfigResourceTypes`, `GroupDescription`,
`ITopicMetadata`), `produce.ts:1`, and `errors.ts:14-38` (which classifies by kafkajs error
*names*). Nothing outside `src/engine/adapters/kafka/` imports the driver: `registry.ts:11-19`
loads the directory lazily and is its only importer, and `grep -rn kafkajs src/` outside that
directory matches only three doc comments (`shared/domain/streamFilter.ts:11,20`,
`shared/domain/tabs.ts:106`) plus `registry.ts:6`'s own comment.

**F2 — connection setup is one long-lived `Admin`, no pooling, and a cluster-id probe.**
`client.ts:51-58` builds `new Kafka({ clientId, brokers: ['host:port'], connectionTimeout: 10_000,
logLevel: NOTHING, ssl, sasl })`, `client.ts:60-65` connects the admin, and `index.ts:43` then calls
`admin.describeCluster()` purely to fill `ConnectInfo.details.cluster`. `sslmode` is collapsed to a
boolean at `client.ts:41-49`: `require`/`prefer`/`verify-full` all mean `ssl: true`, anything else
warns and is ignored. Per P10's D17 there is deliberately no `ConnectionSet`/LRU here.

**F3 — every catalog and definition read is an `Admin` call, and two of them have no equivalent in
the new client.** `catalog.ts:20-25` destructures `{ topics }` from `admin.fetchTopicMetadata()`
(all topics), `catalog.ts:47` uses `admin.listGroups()`, `catalog.ts:68` uses
`admin.fetchTopicMetadata({ topics: [topic] })`; `definition.ts:21` the same;
`definition.ts:44-47` uses `admin.describeConfigs({ resources: [{ type: ConfigResourceTypes.TOPIC,
name: topic }] })`; `definition.ts:100-105` `admin.describeGroups([groupId])`;
`definition.ts:132` `admin.fetchOffsets({ groupId })`. `read.ts:65` and `read.ts:96` use
`admin.fetchTopicOffsets(topic)` and `admin.fetchTopicOffsetsByTimestamp(topic, ms)`;
`read.ts:225-238`'s `countTopic` is watermark subtraction over `fetchTopicOffsets`.

**F4 — the group-join is one call site, and it exists only to make `seek()` work.**
`read.ts:158-159` mints `kira-studio-browse-${crypto.randomUUID()}` and
`kafka.consumer({ groupId, sessionTimeout: 15_000 })`; `read.ts:168` `subscribe({ topic,
fromBeginning: false })`; `read.ts:179-201` `run({ eachMessage })`; and `read.ts:203-207` carries the
comment that says the quiet part out loud: *"seek() is documented to run after run() — kafkajs
applies it once this consumer (the sole member of a fresh, unique group subscribed to only this
topic) joins and is assigned every partition."* So the group exists to obtain an assignment that the
adapter already knows exactly — it computed the partition list and the start offsets itself in
`freshWindows` (`read.ts:57-124`).

**F5 — everything the browse actually needs is already computed before the consumer exists.**
`freshWindows` returns `PartitionWindow[]` (`read.ts:13-17`: `partition`, `next`, frozen `end`),
`read.ts:151` narrows to the partitions with `next < end`, and `read.ts:186` re-checks every
delivered message against its window anyway. The consumer's only job is "give me the bytes from
offset X of partition P".

**F6 — the browse's cancel path is `consumer.stop()`, registered on `ctx.signal`.**
`read.ts:160-163` and the `finally` at `read.ts:217-221` (`stop()` then `disconnect()`);
`index.ts:131-135` and `caps.ts:30` both document that `Adapter.cancel()` is a permanent no-op
because this signal bridge is the whole mechanism (P10's D6/D14, `docs/v1/plans/P10-kafka-sqs.md:316`).

**F7 — produce is one ephemeral producer per `mutate()`.** `produce.ts:65` `kafka.producer()`,
`produce.ts:71-84` connect / `send({ topic, messages: [{ key, value, headers }] })` per op /
disconnect in `finally`. Headers are a plain `Record<string, string>` parsed from the `$headers`
sentinel (`produce.ts:16-35`).

### Why the client has to change

**F8 — `kafkajs` has not shipped since February 2023, and its consumer-group path is the documented
casualty of Kafka 4.** `package.json:73` pins `kafkajs@2.2.4`; the npm registry's own `time` map
(fetched from `registry.npmjs.org` in this container) gives `2.2.4` a publish date of
**2023-02-27** and a `modified` timestamp identical to it — no release in the three and a half years
since, with `2.3.0-beta.3` never promoted. Kafka 4.0's KIP-896 removed client protocol API versions
older than AK 2.1, and `tulios/kafkajs#1752` reports KafkaJS failing against a 4.0 KRaft broker
specifically on the **GroupCoordinator** path (`Invalid receive (size = -720899)` broker-side, *"The
group coordinator is not available"* client-side), with produce unaffected and Kafka 3.6.1 working.
That is F4's code path, exactly.
Sources: [KIP-896](https://cwiki.apache.org/confluence/display/KAFKA/KIP-896%3A+Remove+old+client+protocol+API+versions+in+Kafka+4.0) ·
[kafkajs#1752](https://github.com/tulios/kafkajs/issues/1752) ·
[Kafka 4.0 upgrade notes](https://kafka.apache.org/40/getting-started/upgrade/)

**F9 — SPEC.md has named the destination since before P10.** `docs/v1/SPEC.md:99-101` lists the
driver set as *"`pg`, `mariadb`, `mongodb`, `ioredis`, `@confluentinc/kafka-javascript` (native,
heavier, but actively maintained where `kafkajs` has stalled), `@aws-sdk/client-sqs`,
`@aws-sdk/client-s3`"*. P10 knowingly diverged: its D15
(`docs/v1/plans/P10-kafka-sqs.md:325`) records *"`kafkajs` replaces SPEC.md §3's named
`@confluentinc/kafka-javascript` driver"* because *"`@confluentinc/kafka-javascript`'s native
binding fails to load under Bun's ABI (127 vs required 137)"* — hands-on tested at the time. **P32
is the reversal of that D15, and F19 explains the ABI mismatch it hit.**

### What the new client actually offers (read from the published tarball, v1.10.0)

*Everything in this section was read out of `@confluentinc/kafka-javascript@1.10.0` downloaded from
`registry.npmjs.org` into this container's scratchpad; paths below are inside that package.*

**F10 — the package ships two APIs from one module.** `lib/index.js` is
`module.exports = { ...RdKafka, RdKafka, KafkaJS }`: the node-rdkafka-style callback API at the top
level (`KafkaConsumer`, `Producer`, `AdminClient`, `librdkafkaVersion`) and a promisified
KafkaJS-compatible layer under `.KafkaJS` (`types/kafkajs.d.ts:103-108`:
`class Kafka { producer(); consumer(); admin() }`). Both accept raw librdkafka properties —
`MIGRATION.md:114` — so one config object can feed both.

**F11 — the compat `Admin` covers six of the adapter's eight admin calls, and is missing the other
two outright.** `types/kafkajs.d.ts:426-470` lists `connect`, `disconnect`, `createTopics`,
`deleteTopics`, `listTopics`, `listGroups`, `describeGroups`, `deleteGroups`, `fetchOffsets`,
`deleteTopicRecords`, `fetchTopicMetadata`, `fetchTopicOffsets`, `fetchTopicOffsetsByTimestamp`.
There is **no `describeConfigs` and no `describeCluster`** — and not in the native admin either
(`types/rdkafka.d.ts:504-548` — `describeTopics`, `listOffsets`, `listConsumerGroupOffsets`,
`deleteRecords`, …). `grep -rni "describeconfig\|clusterid" lib/ types/` in the package returns
nothing but two prose mentions of the broker-side IncrementalAlterConfigs API. So F3's
`definition.ts:44-47` (topic configuration) and F2's `index.ts:43` (cluster id) have no replacement
inside this client.

**F12 — the compat `Consumer` cannot do manual assignment; the native `KafkaConsumer` can.** The
compat consumer type is `subscribe / stop / run / storeOffsets / commitOffsets / committed / seek /
pause / paused / resume / assignment` (`types/kafkajs.d.ts:385-397`) — it exposes
`assignment()` (read) but no `assign()` (write), and `ConsumerConfig.groupId` is required
(`:223-224`). The native class has exactly what a group-less browse needs
(`types/rdkafka.d.ts:212-263`): `assign(assignments: Assignment[])` where
`Assignment = TopicPartition | TopicPartitionOffset` (`:90`, `:78-80` — `offset: number`),
`consume(number, cb)` for bounded non-flowing reads, `queryWatermarkOffsets`, `offsetsForTimes`,
`position`, `pause`/`resume`, `unassign`, `seek`, plus `getMetadata` from the shared
`Client` base (`:201-204`).

**F13 — a `group.id` is still *required config* for a native consumer, but nothing joins a group
until `subscribe()` is called.** `INTRODUCTION.md:818` — *"The `group.id` and `bootstrap.servers`
properties are required for a consumer"* — and `INTRODUCTION.md:218` — *"The consumer does not
actually join the consumer group until `run` is called. Joining a consumer group causes a rebalance
within all the members of that consumer group."* The library's own consumer-method table
(`INTRODUCTION.md:373-384`) lists `subscribe`/`run` as the group-joining pair; `assign` is on the
native class and is not one of them. **A configured-but-never-subscribed `group.id` is therefore a
required string that produces no group, no JoinGroup, and no rebalance** — the thing P32 asks for.
This must be confirmed on a live broker by the assertion in §5 (`listGroups()` never shows the
browse group), not trusted.

**F13a — the same three facts, read out of the vendored librdkafka 2.15.0 source rather than the
JS docs, including the one round trip that does *not* disappear.** The tarball ships
`deps/librdkafka/` (F18), so the mechanism is checkable rather than inferred:
`rdkafka.c:2825-2838` creates a consumer-group handle **only** when `group.id` is a non-empty
string, and routes a consumer without one to the "Legacy consumer" queue; `rdkafka.c:5384-5390`
(`rd_kafka_consumer_poll`) returns `RD_KAFKA_RESP_ERR__UNKNOWN_GROUP` when there is no group handle
— and `consume(n, cb)` is `consumer_poll` underneath (`lib/kafka-consumer.js:477-489`,
`_consumeNum`). That is why `group.id` is *required config* and cannot simply be omitted. The
group-handle state machine then only issues JoinGroup/SyncGroup/Heartbeat once there is a
subscription: `rdkafka_cgrp.c:7246-7262` shows a fresh handle going INIT → QUERY_COORD and stopping
there. **So the honest claim is precise:** an `assign()`-only browse sends no JoinGroup, no
SyncGroup, no Heartbeat, no LeaveGroup and — with `enable.auto.commit: false` and explicit start
offsets (D19) — no OffsetCommit and no OffsetFetch, so the broker never creates group state and the
group never appears in `listGroups()`. It may still send one **FindCoordinator**, which is a lookup,
not a membership operation. Removing even that would require librdkafka's simple-consumer API,
which this binding does not expose.

**F14 — `stop()` does not exist on the compat consumer, and error classification moves from names to
codes.** `MIGRATION.md:325` — *"`stop` is not yet supported, and the user must disconnect the
consumer"* — which is F6's exact call. `MIGRATION.md:358` — *"Convert any checks based on
`instanceof` and `error.name` to error checks based on `error.code`"* — and `MIGRATION.md:392-410`
removes `KafkaJSNumberOfRetriesExceeded` and `KafkaJSConnectionClosedError` outright: both are
branches of today's `errors.ts:14-31`. The replacement vocabulary is `ErrorCodes`
(`types/errors.d.ts`): `ERR__TRANSPORT` (**-195**), `ERR__RESOLVE` (**-193**), `ERR__PARTITION_EOF`
(**-191**), `ERR__UNKNOWN_TOPIC` (**-188**), `ERR__ALL_BROKERS_DOWN` (**-187**), `ERR__TIMED_OUT`
(**-185**), `ERR__STATE` (**-172**), `ERR__AUTHENTICATION` (**-169**),
`ERR_UNKNOWN_TOPIC_OR_PART` (**3**), `ERR_TOPIC_AUTHORIZATION_FAILED` (**29**),
`ERR_SASL_AUTHENTICATION_FAILED` (**58**).

**F15 — four return shapes differ from kafkajs in ways that break today's code at compile time (the
good case) or at runtime (the one that matters).**
1. `fetchTopicMetadata` returns `Array<ITopicMetadata>` **directly**, not `{ topics: [...] }`
   (`types/kafkajs.d.ts:454-458`) — `catalog.ts:20-26`, `catalog.ts:66-72` and `definition.ts:19-25`
   all destructure `{ topics }`.
2. `GroupDescription.state` is a **numeric enum** (`ConsumerGroupStates`, `types/rdkafka.d.ts:346-353`,
   `:427`), not kafkajs's `'Stable'`/`'Empty'` string — `definition.ts:111` renders it straight into
   a row value, so without a mapping the Group section would read `state 5`. The same type adds
   `partitionAssignor`, `type` (`ConsumerGroupTypes` — classic vs the KIP-848 `consumer` protocol)
   and `coordinator` (`types/rdkafka.d.ts:419-431`).
3. Native `Message.headers` is `MessageHeader[]` — an **array of single-pair objects**
   (`types/rdkafka.d.ts:103`, `:114`) — where kafkajs's `IHeaders` is a record;
   `read.ts:19-31`'s `headersToPlain` walks `Object.entries` of a record and must be rewritten to
   fold an array (duplicate keys are legal and become the existing `string[]` case).
4. Native `Message.offset` and `TopicPartitionOffset.offset` are `number`
   (`types/rdkafka.d.ts:78-80`, `:108`), while the adapter's `PartitionWindow` carries decimal
   **strings** because *"kafka offsets are int64, too large for a JS `number`"*
   (`src/shared/domain/streamFilter.ts:11`). `admin.fetchTopicOffsets` still returns strings
   (`types/kafkajs.d.ts:459-463`), so only the assign boundary needs a conversion — with a real
   `Number.isSafeInteger` guard, not a hope.

**F16 — `admin.connect()` proves nothing about broker reachability.** `lib/kafkajs/_admin.js:221-261`
resolves on the `ready` event of a *synchronously created* librdkafka admin handle (its own comment:
*"AdminClient creation is a synchronous operation for node-rdkafka"*). Today's `client.ts:60-65` +
`index.ts:43` get their connectivity check for free from `describeCluster()`; once that call is gone
(F11), `connect()` needs an explicit bounded probe or a wrong host would "connect" and only fail on
first tree expand — which `tests/db/kafka.spec.ts:90-100` would not catch but a user immediately
would.

**F17 — the compat producer keeps `produce.ts` almost intact, with one latency footgun.**
`types/kafkajs.d.ts:198-201` (`send(record): Promise<RecordMetadata[]>`) and `:147-162` (`IHeaders`,
`Message`) match `produce.ts:79-82` field for field. But `MIGRATION.md:194-199` warns that awaiting
every `send()` with the default `linger.ms` adds a batching delay per message, and recommends
`'linger.ms': 0` for exactly the await-each-message shape `produce.ts:71-84` uses. `acks`,
`compression` and `timeout` are per-producer, not per-send (`MIGRATION.md:138-141`) — the adapter
sets none of them, so nothing else moves.

### The native-module reality (probed from this container)

**F18 — this is a NAN addon, not N-API, and it statically links librdkafka 2.15.0 and OpenSSL
3.5.6.** `package.json`'s deps are `nan ^2.22.0`, `bindings`, `@mapbox/node-pre-gyp`, and
`binding.gyp:24` includes `<!(node -e "require('nan')")`; the C++ sources are `src/*.cc` with
`deps/librdkafka` vendored (559 of the tarball's 643 files). `strings` over the downloaded
darwin-arm64 prebuild reports `OpenSSL 3.5.6` and full SASL/OAUTHBEARER support, so `security.protocol`
and SASL PLAIN work out of the prebuilt binary with no system OpenSSL. NAN means the addon is
compiled against **V8's C++ API**, which is what makes both the Electron ABI and the Bun questions
below sharp rather than theoretical.

**F19 — prebuilt binaries exist per *Node* ABI only; Electron 43's ABI is 148 and has none.**
`package.json`'s `binary` block resolves
`{module_name}-v{version}-{node_abi}-{platform}-{libc}-{arch}.tar.gz` under
`https://github.com/confluentinc/confluent-kafka-javascript/releases/download/`. Range-GET probes
from this container (206 = present, 404 = absent):

| asset | result |
|---|---|
| `…-node-v108/115/127/137-linux-glibc-x64.tar.gz` | **206** (Node 18/20/22/24) |
| `…-node-v127-darwin-unknown-arm64.tar.gz`, `…-node-v137-darwin-unknown-arm64.tar.gz` | **206** |
| `…-node-v139-…`, `…-node-v141-…`, `…-electron-v37-…` | **404** |
| `…-node-v148-darwin-unknown-arm64.tar.gz`, `…-node-v148-linux-glibc-x64.tar.gz` | **404** |

`node_modules/electron/abi_version` reads **148** for the pinned `electron@43.4.1`
(`package.json:55`), and `src/main/engine-host.ts:2,38` runs the engine via Electron's
`utilityProcess.fork()` — i.e. **inside Electron, at ABI 148**. So the shipped app can only ever run
a from-source build against Electron's headers; there is no prebuild to download, ever. The
downloaded darwin-arm64 prebuild is a 9.5 MB `.node` plus ~8 MB of `obj.target/*.o` intermediates,
inside a package whose unpacked size is 14.4 MB.

**F20 — this container cannot build for Electron: the headers host is proxy-blocked.**
`https://artifacts.electronjs.org/headers/dist/index.json` fails with `CONNECT tunnel failed,
response 403`; `https://electronjs.org/headers/…` likewise; `https://nodejs.org/download/release/…`
returns **200** and `https://github.com/electron/electron/releases/download/v43.4.1/SHASUMS256.txt`
returns **302**, so this is a specific host denial, not general egress. The headers are *not*
published as GitHub release assets either (probed `node-v43.4.1-headers.tar.gz`,
`node-headers-v43.4.1.tar.gz`, `iojs-v43.4.1-headers.tar.gz` → all **404**), so AGENTS.md's
curl-the-binary-from-GitHub workaround (`AGENTS.md:57-63`) has no analogue here. **The Electron-ABI
build of this module can only be produced on the macOS/Colima box.**

**F21 — Bun cannot load this addon, and the ABI number was never the real obstacle. Probed to a
conclusion in this container; this is no longer an open question.** The probe: extract the published
tarball plus a downloaded prebuild into a scratch `node_modules` (with `bindings` and
`file-uri-to-path` beside it) and `require` it from each runtime.

| runtime | reported ABI (`process.versions.modules`) | binary given to it | result |
|---|---|---|---|
| Node 22.22.2 | 127 | `node-v127-linux-glibc-x64` | **loads.** `librdkafkaVersion` `2.15.0`; `features` = `gzip,snappy,ssl,sasl,regex,lz4,sasl_plain,sasl_scram,plugins,zstd,sasl_oauthbearer,http,oidc`; `new KafkaConsumer({…}, {})` constructs and exposes `assign`/`consume` |
| Bun 1.3.11 (the version installed here) | 137 | `node-v127` (what a `node`-driven install leaves) | *"The module 'kafka' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION 127. This version of Bun requires NODE_MODULE_VERSION 137"* — **P10's D15, verbatim** |
| Bun 1.3.11 | 137 | `node-v137-linux-glibc-x64` — the **matching** ABI | **process dies:** `bun: symbol lookup error: …/confluent-kafka-javascript.node: undefined symbol: _ZN2v816FunctionTemplate12SetClassNameENS_5LocalINS_6StringEEE` (`v8::FunctionTemplate::SetClassName`), exit 127 |
| Bun 1.4.0 (downloaded to scratch, not installed) | **147** | — | no `node-v147` prebuild exists (Confluent publishes through Node 24 = 137, F19), and the same `SetClassName` gap remains |

So P10's D15 recorded the *symptom* (an ABI number mismatch) and this phase can now record the
*cause*: Bun's V8 C++ shim does not implement the V8 entry points a NAN addon links against, so
fixing the ABI selection only moves the failure from a readable error to a dynamic-linker abort.
Upgrading Bun makes it strictly worse — a newer Bun claims a newer ABI that Confluent does not
publish at all. **`tests/db/kafka.spec.ts` therefore cannot run under `bun test` after this phase,
under any install configuration** (D27), and — the flip side — **the Node ABI is not needed anywhere
in this repo either**, because nothing that loads this driver runs under plain Node: the engine runs
inside Electron (F19) and the fixture stops using a JS client entirely (D26). One ABI, not two.
Sources: [Bun issue #4290](https://github.com/oven-sh/bun/issues/4290) ·
[How Bun supports V8 APIs without using V8](https://bun.com/blog/how-bun-supports-v8-apis-without-using-v8-part-1)

**F22 — Bun will not even run the install script unless the package is trusted, and packaging
assumes no native production dependency exists.** `package.json:9-12` lists
`trustedDependencies: ["electron", "esbuild"]`; Bun blocks lifecycle scripts for anything else, and
`@confluentinc/kafka-javascript`'s `install` script *is* `node-pre-gyp install --fallback-to-build`.
On the packaging side, `electron-builder.yml:17` reads `npmRebuild: false  # no native production
dependency exists (D14)` and `docs/v1/PACKAGING.md:42-43` repeats it — *"every native dependency in
the tree belongs to a devDependency; the production dependency set is pure JS"*. Both statements
stop being true in this phase. Production `node_modules` **are** copied into the asar today without
`files` naming them (`docs/v1/PACKAGING.md:58` — 23 `node_modules/pg` entries), so the new package
will be copied wholesale, sources and `.o` files included, against a 300 MB bundle budget currently
sitting at **252 MB** (`docs/v1/PERF.md`, lever L-D).

### Tests and fixtures

**F23 — the test broker is Apache Kafka 3.6, and the container module already knows about Kafka 4.**
`tests/db/support/kafka.ts:14` pins `confluentinc/cp-kafka:7.6.1` with `.withKraft()`
(`:37-40`) and its comment explains why not `apache/kafka` (P10's D15). Confluent Platform 8.0 is
built on **Apache Kafka 4.0** (and CP 8.x is the AK 4.x line); Docker Hub lists `cp-kafka` tags
`8.0.0`–`8.0.7`, `8.1.x`, `8.2.x`, `8.3.x` for both `amd64` and `arm64` (queried from this
container). The installed `@testcontainers/kafka@12.1.0`
(`node_modules/@testcontainers/kafka/build/kafka-container.js:31-33`) **auto-enables KRaft for any
tag `>=8.0.0`** and keeps the same `KAFKA_*`-env + `/etc/confluent/docker/run` contract, so the
image bump is a constant change, not a fixture rewrite.
Source: [Introducing Confluent Platform 8.0](https://www.confluent.io/blog/introducing-confluent-platform-8-0/)

**F24 — the seed runs the driver in *two* non-Electron processes, and one of them creates a consumer
group by joining it.** `tests/db/fixtures/0005_kafka_seed.ts:1` imports `kafkajs`'s `Kafka` type;
`:15-31` creates topics and produces 6 messages with a `source: seed` header; `:40-58` connects a
real consumer to `CONSUMER_GROUP`, drains the topic and disconnects, *"so this drains ORDERS_TOPIC
under CONSUMER_GROUP once before tearing the consumer down"* — i.e. the fixture depends on the very
group-join that Kafka 4 breaks for kafkajs (F8). `tests/db/support/kafka.ts:45-46` calls it from the
Bun test process; `tests/ui/kafka.spec.ts:8,31` calls the same seed from the **Playwright/Node**
process while the app under test loads the driver inside **Electron**. With a native driver that is
two runtimes that cannot both load it (F21) sharing one `node_modules` in one run — which is why
D26 takes the JS client out of the fixture entirely rather than porting it: after that, the seed is
a runtime the driver never enters.

**F25 — four `tests/db/kafka.spec.ts` assertions encode things this phase changes.**
`:93-94` asserts `serverVersion === 'Kafka'` **and** `details?.cluster` is truthy (F11 kills the
cluster id); `:192-197` asserts the topic definition's sections are exactly
`['Partitions', 'Configuration']` with `config.rows.length > 0` (F11 kills `describeConfigs`);
`:204-214` asserts the group definition's three sections and its committed offsets;
`:334-336` documents kafkajs's own retry backoff as the reason scenario 11 needs a 20 s timeout.
`tests/ui/kafka.spec.ts` skips cleanly when Docker is unavailable (`:26-31`), while
`tests/db/kafka.spec.ts:81` **throws** instead — neither can run in this container (`AGENTS.md:43-48`).

## 2. Shapes introduced in this plan

```ts
// src/engine/adapters/kafka/client.ts — REWRITTEN. One resolved librdkafka config, built once,
// shared by every client this adapter creates: the compat Admin (catalog/definition/watermarks),
// the compat Producer (mutate), and the native browse consumer (read). No kafkaJS block — raw
// librdkafka properties are accepted by both APIs (MIGRATION.md:114), so there is one vocabulary
// in this file instead of two.

/** Frozen at connect(); every client below is constructed from a copy of it. */
export type RdConfig = Readonly<Record<string, string | number | boolean>>;

export interface KafkaClientHandle {
  readonly rdConfig: RdConfig;
  /** KafkaJS-compat factory — producers only (D11); the browse consumer is native (D19). */
  readonly kafka: Kafka;
  readonly admin: Admin;
  /** From the connect-time metadata probe (D13) — what ConnectInfo.details reports now. */
  readonly brokerCount: number;
}

export async function connectKafka(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<KafkaClientHandle>;
```

```ts
// src/engine/adapters/kafka/read.ts — the browse rewritten onto manual assignment. freshWindows(),
// PartitionWindow, finishPosition(), the page token and countTopic() are UNCHANGED (D20): they were
// always admin-side, and admin still answers them.

/** Required by librdkafka for any consumer (INTRODUCTION.md:818) and never joined: this consumer
 *  only ever assign()s, and a group is joined by subscribe()/run() (F13, D19). */
const BROWSE_GROUP_ID = 'kira-studio-browse';
/** One poll's fetch window. Also the worst-case latency between an abort and the loop noticing. */
const POLL_TIMEOUT_MS = 1_000;
/** Consecutive empty polls that end a browse whose windows can never be filled — a compacted or
 *  retention-deleted range inside [next, end) (D21). */
const MAX_EMPTY_POLLS = 2;

export async function readTopic(
  handle: KafkaClientHandle,
  topic: string,
  req: Omit<ReadRequest, 'path'>,
  ctx: OpCtx,
): Promise<StreamPage>;

export async function countTopic(
  admin: Admin,
  topic: string,
  ctx: OpCtx,
): Promise<{ value: number; exact: boolean }>;   // unchanged
```

```ts
// src/engine/adapters/kafka/errors.ts — classification moves from error names to librdkafka codes
// (F14). The AdapterError code set and the "server's own message verbatim" rule (adapter.ts:41-43)
// are unchanged.
export function mapKafkaError(err: unknown): AdapterError;
```

```ts
// src/engine/adapters/kafka/definition.ts — additions only where the new client hands over more
// than kafkajs did, and one honest subtraction (D14/D16).

/** ConsumerGroupStates / ConsumerGroupTypes are numeric enums in this client (F15.2) — rendering
 *  the number would be a regression, so both get a name lookup. */
function groupStateName(state: ConsumerGroupStates): string;
function groupTypeName(type: ConsumerGroupTypes): string;
```

```sh
# scripts/native-electron-build.sh — NEW. Guarantees the driver's .node is built for the ABI of the
# pinned Electron before anything that loads it runs (D6). Exactly one ABI exists in this repo
# (F21): Electron's, read from node_modules/electron/abi_version (148 for electron@43.4.1).
#   1. read the target ABI; compare with .native-abi, the marker written beside the built module
#   2. if it matches, exit 0 (the common case: one `cat`)
#   3. else restore .cache/native/confluent-kafka-javascript/<abi>.node if present (a file copy)
#   4. else `electron-rebuild --only @confluentinc/kafka-javascript` — a from-source librdkafka
#      build, minutes not seconds; cache the result under <abi> and write the marker
# Wired as predev, pretest:ui, pretest:db:kafka and prepackage:mac (never pretest:db — the other
# six engines never touch this driver). Cannot run in Claude Code's Linux web container: Electron's
# headers host is proxy-blocked (F20).
```

```yaml
# electron-builder.yml — a native production dependency exists now (D5/D7).
# npmRebuild stays false; the Electron-ABI build is produced by scripts/native-electron-build.sh before
# packaging, not by electron-builder's own rebuild step (which has no Bun support).
asarUnpack:
  - out/main/engine.js
  - node_modules/@confluentinc/kafka-javascript/build/Release/*.node
files:
  - '!node_modules/@confluentinc/kafka-javascript/{deps,src,util,examples,ci}/**'
  - '!node_modules/@confluentinc/kafka-javascript/build/Release/{obj.target,.deps}/**'
```

## 3. Decisions

### Topic A — the dependency, the ABI, and packaging

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`@confluentinc/kafka-javascript@1.10.0` becomes a production `dependency`, pinned exact, and `kafkajs@2.2.4` is deleted from `package.json` in the same commit.** | The repo pins every dependency exactly (`package.json:35-79`), and 1.10.0 is the current `latest` (librdkafka 2.15.0). Keeping `kafkajs` "just for `describeConfigs`" would ship a second, unmaintained protocol implementation whose known Kafka 4 failure mode (F8) is the reason for this phase — and §0's one-driver rule exists so the next reader cannot find two answers to "how does this app talk to Kafka". |
| D2 | **`trustedDependencies` gains `@confluentinc/kafka-javascript`** (`package.json:9-12`), and the `.node` it produces is treated as a *bootstrap*, not as the artifact the app loads. | Bun blocks lifecycle scripts by default and this package's whole install *is* a lifecycle script (`node-pre-gyp install --fallback-to-build`, F22); untrusted, `bun install` leaves a package with no `build/` at all and the first `require` fails inside `bindings`, which reads like a code bug and is not one. What the install downloads is a *Node*-ABI prebuild (F19) — useless to the shipped app, which runs at Electron's ABI, but useful twice: it makes `node -e "require('@confluentinc/kafka-javascript')"` work for driver-level spikes (how F10–F17 were confirmed), and it gives `electron-rebuild` a normal package layout to rebuild in place. D6's marker file is what stops the two from being confused: after `native-electron-build.sh` runs, the binary on disk is Electron's and the marker says so. |
| D3 | **The engine keeps loading the driver lazily; no change to `registry.ts`.** | `registry.ts:11-19` already defers `import('./kafka')` until a Kafka connection is created (P12's lever L-A, `docs/v1/PERF.md:136`), which now also defers a `dlopen` of a 9.5 MB static binary. That is a bigger win than it was for a pure-JS driver, and it is already in place — this phase must simply not undo it by adding a top-level import anywhere else. |
| D4 | **A note in `docs/v1/PERF.md` records that the Kafka driver's memory is now un-reclaimable once loaded**, without re-running P12's measurement suite. | A native module cannot be unloaded from a process; opening one Kafka connection permanently raises the engine's floor for the life of that engine. It is honest to say so next to L-A's numbers, and dishonest to leave PERF.md implying the driver set is symmetric. Re-measuring the whole memory suite is P12's job, not this phase's — §6. |
| D5 | **`electron-builder.yml` keeps `npmRebuild: false`, and the Electron-ABI build is produced by `scripts/native-electron-build.sh` before packaging** (wired as a `prepackage:mac` script). | electron-builder's rebuild step shells out to the detected package manager; this repo uses Bun, which electron-builder does not support as a rebuild driver. An explicit script keeps the mechanism visible, makes the same build available to `bun run dev` and `test:ui` (which need it just as much — they run the real Electron), and matches the repo's existing script-driven verification style (`scripts/verify-packaging.sh`). The `npmRebuild: false` **comment** must change: its claim ("no native production dependency exists") is now false even though the setting is right. |
| D6 | **`scripts/native-electron-build.sh` guarantees one binary for one ABI — Electron's.** It reads `node_modules/electron/abi_version`, compares it with the `.native-abi` marker beside the built module, and exits, restores from `.cache/native/…/<abi>.node`, or runs `electron-rebuild --only @confluentinc/kafka-javascript`. Wired as `predev`, `pretest:ui`, `pretest:db:kafka` and `prepackage:mac` — **not** `pretest:db`, which after D27 runs no Kafka code at all. | F21 settles what P10's D15 only observed: Bun cannot load a NAN addon at any ABI, so there is no second runtime to serve and no ABI switching to arbitrate. Every consumer of this driver — `bun run dev`, `test:ui`, the packaged app, and the Kafka suite under `ELECTRON_RUN_AS_NODE=1` (D27) — is Electron at ABI 148. The marker keeps the common case at one `cat`; the cache keyed by ABI means an Electron upgrade rebuilds once and a downgrade is a file copy. `@electron/rebuild` is added as a devDependency for this and nothing else. |
| D7 | **`asarUnpack` gains the `.node`, and `files` excludes the vendored librdkafka sources, `src/`, `util/`, `examples/`, `ci/` and `build/Release/{obj.target,.deps}`.** | Electron cannot `dlopen` from inside an asar archive — the same constraint that already unpacks `out/main/engine.js` (`electron-builder.yml:12-16`). The exclusions drop ~11 MB of C sources and ~8 MB of `.o` intermediates (F19) that are pure build residue; the L-D bundle budget has 48 MB of headroom (252 of 300 MB) and this phase should spend a few MB of it on a runtime binary, not on object files. `verify-packaging.sh` gains an A6 check that the `.node` is present and unpacked, so a future `files` edit cannot silently break the packaged app. |
| D8 | **`docs/v1/PACKAGING.md` §2 and `AGENTS.md` are updated by the implementing session**: PACKAGING.md's `npmRebuild` bullet is rewritten, and AGENTS.md gains a short "Native Kafka driver (librdkafka)" section stating that the driver loads only under Electron's ABI and never under Bun (F21), the `native-electron-build.sh` step, and F20's finding that the Electron-ABI build cannot be produced in Claude Code's Linux web container. | AGENTS.md already carries exactly this genre of hard-won environment fact for Docker (`:32-48`), the Electron binary (`:50-70`) and secrets (`:72-92`); an agent that hits "was compiled against a different Node.js version" with no note to read will burn an hour rediscovering F19/F20. Standing practice is that the implementing session makes the doc edits (P27 D34, P24 D41). |

### Topic B — which API surface, and the adapter rewrite

| # | Decision | Rationale |
|---|----------|-----------|
| D9 | **Catalog, definition, watermark and timestamp calls use the KafkaJS-compat `Admin`** (`.KafkaJS`), not the native callback `AdminClient`. | Six of the eight admin calls the adapter makes exist on the compat surface with the *same names, arguments and (mostly) return shapes* (F11), so the diff is a handful of lines rather than a promisification layer over `describeTopics`/`listOffsets`/`listConsumerGroupOffsets` with hand-rolled result mapping. The two missing calls (F11) are missing from **both** surfaces, so the native API would buy nothing back. |
| D10 | **The browse consumer is the native `KafkaConsumer`, and nothing else in the adapter is native.** | The compat consumer has no `assign()` (F12), so a group-less browse is not expressible on it at all — this is the one place where the compat layer genuinely cannot do the job, and the phase's second requirement is precisely that job. Confining native usage to one function keeps the callback/EventEmitter idiom out of `index.ts`, `catalog.ts`, `definition.ts` and `produce.ts`. |
| D11 | **Producing keeps the compat `Producer`, still ephemeral per `mutate()`, with `'linger.ms': 0` added.** | `produce.ts:79-82` maps field-for-field onto the compat `send()` (F17), so the diff is the import and one config property. `linger.ms: 0` is the library's own recommendation for the await-each-send shape this code uses (F17); without it every staged message pays the default batching delay, which a user watching a one-message produce would read as the app being slow. Ephemeral-per-mutation stays because P10's D17 chose it deliberately and nothing here changes the trade. |
| D12 | **One `RdConfig` object, raw librdkafka properties, built once in `client.ts`** — `bootstrap.servers`, `client.id`, `security.protocol`, `sasl.mechanism`/`sasl.username`/`sasl.password`, `socket.connection.setup.timeout.ms` — and every client (admin, producer, browse consumer) is constructed from a copy of it. | The compat layer accepts native properties outside the `kafkaJS` block (`MIGRATION.md:114`) and the native consumer accepts nothing else, so a single vocabulary means the SSL/SASL resolution in `client.ts:41-58` exists once instead of twice in two dialects. Freezing it makes "which properties is this connection actually using" answerable by reading one object. |
| D13 | **`ConnectInfo` loses `details.cluster` and gains `details.brokers` + `details.librdkafka`; `serverVersion` stays the literal `'Kafka'`. `connect()` ends with a bounded `admin.listTopics({ timeout })` probe.** | There is no cluster id in this client at all (F11) — no `describeCluster`, and `grep clusterid` over the package finds nothing. `details` is free-form (`adapter.ts:27-28`) and is not read anywhere in the renderer (only `serverVersion` is, via `main/connections.ts:206` → `project/state/tree.ts:433`), so the swap costs the user nothing while broker count and the linked librdkafka version are genuinely useful in a connection tooltip. The probe replaces the connectivity check `describeCluster()` was accidentally providing (F16); without it a typo'd host connects successfully and fails later, which is a worse error at a worse time. |
| D14 | **The topic definition's Configuration section is kept as a section, rendered empty, with a `notes` line: the client exposes no `DescribeConfigs`.** `ConfigResourceTypes`, `includeSynonyms` and the sensitive-value mask leave with it. | `definition.ts:41-63` already has exactly this degradation path for a cluster that denies `DESCRIBE_CONFIGS`, and its comment already argues the case: a missing section must not fail the whole tab. This is a real, user-visible loss against P23 (`docs/v1/SPEC.md:507`) and the plan refuses to hide it — the note says *why* it is empty, so nobody reads it as a permissions problem. librdkafka has `rd_kafka_DescribeConfigs` in its C API; the JavaScript binding simply does not wrap it, so this can come back from upstream without any change here. §9 asks whether the section should instead be dropped outright. |
| D15 | **The group definition gains what the new client hands over for free:** `state` and `type` rendered through name lookups, plus `partitionAssignor` and the coordinator's `host:port` as two more rows. | `state` is a numeric enum now (F15.2) — a mapping is *required*, not optional, so the choice is between "map two enums" and "map one and drop the other". `type` distinguishes a classic group from a KIP-848 `consumer`-protocol group, which is exactly the kind of thing a Kafka 4 client's group view should show, and it costs one row. |
| D16 | **No `caps.ts` value changes.** `definition: true`, `cancel: true`, `exactCount: true`, `canInsert: true` all stay; only two comments change (the cancel mechanism, D22; the count source, unchanged in substance). | Every capability is still honestly delivered: definitions still render (D14 degrades one section, it does not remove the tab), cancellation is still forwarded to a real client (D22), counts are still watermark subtraction over the same admin call. A cap flip would be the honest move only if a capability actually died; none did. |
| D17 | **`errors.ts` classifies by `error.code` against the exported `ErrorCodes`, with the compat error *names* kept only as a secondary fallback.** Mapping: transport/resolve/all-brokers-down/state → `E_CONNECT`; timed-out (both) → `E_TIMEOUT`; authentication + SASL-auth-failed + topic/group/cluster-authorization-failed → `E_AUTH`; unknown-topic (both spellings) → `E_QUERY`; everything else → `E_QUERY` with the message verbatim. | The library's migration guide is explicit that names are no longer the classification surface and that two of today's three name branches were deleted outright (F14). Codes are a closed, documented, numerically stable set (F14's table), which is a better contract than a string that a library rename can break. Unknown-topic staying `E_QUERY` preserves the deliberate call in `errors.ts:33-38` (and `tests/db/kafka.spec.ts:336-353`) that `E_NOT_FOUND` means "the connection is gone", not "your topic isn't there". Authorization failures move up to `E_AUTH` because the user's remedy is credentials/ACLs, not a different query. |
| D18 | **The three doc comments outside the adapter that name `kafkajs` are corrected in the same phase** (`shared/domain/streamFilter.ts:11,20`, `shared/domain/tabs.ts:106`, `engine/adapters/registry.ts:6`, and `docs/v1/PERF.md:136`'s driver list). No code in those files changes. | They describe *why* offsets are strings and *how* the timestamp filter is resolved — both still true, both attributed to a library that will no longer be in the tree. A comment that names a dependency the repo does not have is how the next reader gets sent to the wrong documentation. |

### Topic C — the group-less browse

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | **The browse consumer never subscribes.** It is constructed with a constant `group.id` (`kira-studio-browse`), `enable.auto.commit: false`, `enable.auto.offset.store: false`, `enable.partition.eof: true`, `auto.offset.reset: 'error'`, then `assign()`s exactly the partitions in `remaining` with their start offsets, and `consume(n, cb)`s until the page is full. | This is the phase's second requirement, implemented at the only place it exists (F4). `group.id` must be *set* (F13, F13a — librdkafka's `consumer_poll` refuses to run without a group handle) and is never *joined*, because joining is what `subscribe()`/`run()` do — so the JoinGroup/SyncGroup round trip, the heartbeat, the rebalance and the `__consumer_offsets` bookkeeping all disappear. What may remain is a single FindCoordinator lookup (F13a), which creates no group state on the broker; the plan claims that much and no more. The `groupId` can go back to a constant precisely because no group is created; the random UUID (`read.ts:158`) existed only to keep concurrent browses out of each other's rebalances. Auto-commit off (both flags) keeps P10's D6 promise that *"browsing a topic leaves no trace in `__consumer_offsets` and never interferes with real consumer groups"* — now structurally rather than by convention. `auto.offset.reset: 'error'` means a start offset that has fallen out of retention surfaces as an error instead of silently jumping to the beginning and returning the wrong page. |
| D20 | **`freshWindows`, `PartitionWindow`, the page token, `finishPosition` and `countTopic` are unchanged** — watermarks still come from `admin.fetchTopicOffsets`, and the timestamp filter still resolves through `admin.fetchTopicOffsetsByTimestamp`. | They were always admin-side (F3) and the compat admin keeps both calls with the same signature and return shape (F11). Leaving them alone means the offset-window token stays byte-compatible, `tests/db/kafka.spec.ts`'s pagination scenarios 7–9 remain a genuine regression guard for the rewrite, and the browse consumer's contract shrinks to "fetch bytes from offset X of partition P" — which is exactly what `assign()` expresses and what `subscribe()` never did. The native consumer's own `queryWatermarkOffsets`/`offsetsForTimes` (F12) are deliberately **not** used: they would move work onto a client that has to be created first, for no gain. |
| D21 | **The poll loop ends on the first of: page full, every window drained, every remaining partition reported EOF, `MAX_EMPTY_POLLS` consecutive empty polls, or abort.** Messages outside their partition's `[next, end)` window are ignored, exactly as today (`read.ts:186`). | A window is computed from watermarks and can outlive the data: compaction or a retention delete can leave `next < end` with nothing actually fetchable, and a loop that waits for a count it can never reach would hang a browse forever. EOF (`enable.partition.eof`) is the precise signal and the empty-poll counter is the belt-and-braces for the case where EOF is not delivered. Ignoring out-of-window messages rather than pausing the partition keeps the loop's state machine to one map and matches today's behaviour byte for byte. |
| D22 | **Cancellation is `consumer.disconnect()` on `ctx.signal`, plus an `aborted` check between polls**; `Adapter.cancel()` stays a permanent no-op. | `stop()` no longer exists — *"the user must disconnect the consumer"* (F14/`MIGRATION.md:325`). Disconnect is strictly stronger than the old stop-then-disconnect pair (`read.ts:217-221`) because it tears the client down rather than parking it. The between-polls check bounds worst-case cancel latency at one `POLL_TIMEOUT_MS`, which is the same order as today's per-message check. `caps.cancel` stays `true` for the reason P10's D14 gave: the *mechanism* works, the method is not the mechanism. |
| D23 | **Offsets cross the native boundary as `Number`, guarded by `Number.isSafeInteger`, and stay decimal strings everywhere else.** A window whose start offset exceeds `2^53-1` fails with a clear `E_UNSUPPORTED` rather than silently browsing the wrong offset. | The native API types offsets as `number` (F15.4) while the app's own contract says int64-as-string (`shared/domain/streamFilter.ts:11`). Converting at exactly one boundary keeps the rest of the pipeline (token, filter, `attrs` column) unchanged. The guard is not theoretical hygiene — silently truncating an offset would produce a page of *plausible but wrong* messages, which is the worst failure mode a DB client can have. Nine quadrillion messages in one partition is not reachable in practice, which is why an explicit error is the right response rather than a fallback path. |
| D24 | **`headersToPlain` folds the native `MessageHeader[]` into today's `Record<string, string \| string[]>`**, promoting a repeated key to an array; `Buffer` values keep decoding as UTF-8. | The wire shape of the `headers` column is consumed by the stream view and by `produce.ts`'s `$headers` round trip (`produce.ts:13-16`) — changing it would be a renderer-visible protocol change in a phase that promises none. Kafka headers are genuinely a list of pairs and duplicates are legal, so folding is the correct direction; the existing `string[]` case (`read.ts:23-26`) already exists for exactly this. |

### Topic D — tests and fixtures

| # | Decision | Rationale |
|---|----------|-----------|
| D25 | **The test broker becomes `confluentinc/cp-kafka:8.0.x` (Apache Kafka 4.0), pinned to an exact patch tag the way 7.6.1 was.** `.withKraft()` stays (harmless, and explicit beats implicit). | A phase whose entire premise is Kafka 4 compatibility that is only ever tested against Kafka 3.6 has verified nothing (F23). CP 8.0 is the AK 4.0 line, `@testcontainers/kafka@12.1.0` auto-enables KRaft for `>=8.0.0` and keeps the same env/entrypoint contract it already uses, and both architectures are published — so this is a constant change plus a comment rewrite. Staying on the 8.0.x line rather than 8.1+/8.2+ keeps the target at *"the first Kafka that removed the old protocol versions"*, which is the compatibility edge this phase is about. |
| D26 | **The seed stops using a JavaScript Kafka client and runs against the container's own CLI** (`kafka-topics --create`, `kafka-console-producer --property parse.headers=true`, and `kafka-consumer-groups --reset-offsets --to-earliest --execute --group … --topic …` to register the group with committed offsets and no members). | This is the decision that dissolves the dual-ABI problem in the test suite (F24): with no client in the Playwright/Node process, `tests/ui` needs only the Electron-ABI binary and `node_modules` never has to hold two. It also removes a second-order absurdity — the fixture creating a consumer group by *joining* one, in a phase about not joining groups — and it makes the seed independent of the library under test, so a driver bug cannot hide behind a seed written with the same driver. `--reset-offsets --execute` on a non-existent group creates committed offsets without any member, which is exactly the state scenario 6 asserts (`tests/db/kafka.spec.ts:199-214`). |
| D27 | **The Kafka adapter suite leaves Bun. `tests/db/kafka.spec.ts` moves to `tests/electron-db/kafka.spec.ts` and runs under `ELECTRON_RUN_AS_NODE=1 electron` via a new `test:db:kafka` script; `bun run test:db` keeps every other engine and no longer collects Kafka.** This is a decision, not a fallback — F21 closed the question. | Bun cannot load a NAN addon at any ABI (F21: matching-ABI load dies on an undefined `v8::FunctionTemplate::SetClassName`), so `bun test` and this driver are mutually exclusive facts, not a configuration to tune. The adapter-level scenarios — error-code classification, cursor/token paging, cancellation, read-only enforcement, the two new group-less tripwires (D30) — are not reachable from `tests/ui`, so deleting them is not an option and leaving them permanently skipped is the "half-implementation" §0 forbids. Electron-as-Node is *more* faithful than the Bun run it replaces: it is the exact runtime and ABI the shipped engine uses (F19). The move out of `tests/db/` (rather than a rename in place) is what keeps `bun test tests/db`'s file matcher from collecting it, since Bun's matcher takes any `*.spec.ts` under the directory it is given. §11's `tests/` layout gains the sibling directory (D34). |
| D28 | **The conversion is mechanical and bounded: `bun:test`'s `describe`/`test`/`beforeAll`/`afterAll` become `node:test`'s `describe`/`test`/`before`/`after`, and every `expect(...)` becomes `node:assert/strict`.** The suite is bundled with esbuild (`--bundle --platform=node --external:electron --external:@confluentinc/kafka-javascript`) to `out/tests/kafka-suite.cjs` before Electron runs it. | Two mechanical obstacles, both real and both cheap once named. (1) `expect` does not exist outside Bun/Jest; the 16 scenarios use `toBe`/`toEqual`/`toMatchObject`/`rejects`/`toHaveLength`/`toBeGreaterThan`/`toMatch`, each of which has a one-line `assert` equivalent (`rejects.toMatchObject` becomes `assert.rejects(p, (e) => e.code === '…')`) — no assertion library is added. (2) Electron cannot execute the TypeScript sources directly: Node's type-stripping rejects the adapter's parameter properties (`index.ts:37`, `constructor(private readonly deps)`) and its ESM resolver rejects the repo's extensionless relative imports — both verified in this container. esbuild is already in the tree (`package.json:8-12`'s `trustedDependencies`, via Vite), so bundling costs a script line rather than a dependency. **`node:test`'s availability inside Electron is the one thing to confirm before writing the conversion** (step 1); if it is absent, `node:assert` plus a twenty-line sequential runner over an array of named async scenarios gives the same output and the same exit code. |
| D29 | **The scenarios F25 lists are updated, not deleted:** `:94` asserts `details.brokers` instead of `details.cluster`; `:192-197` keeps both section titles and asserts the Configuration section is empty **with a note present** (D14); `:334-336`'s comment is rewritten for librdkafka's own metadata timeout and the 20 s allowance is re-checked. | These assertions are the contract this phase changes, so changing them is correct — but each change must assert the *new* promise rather than weaken to nothing. "Configuration is empty and says why" is a stronger assertion than deleting the check, because it fails if the note goes missing. |
| D30 | **Two new `tests/db` scenarios are the proof of the phase's second half:** *17. a browse creates no consumer group* — run a full paged browse, then assert `admin.listGroups()` contains only the seeded group and nothing matching `kira-studio-browse`; *18. a browse leaves no committed offsets* — assert `admin.fetchOffsets({ groupId: 'kira-studio-browse' })` returns nothing for the browsed topic. | "Skip the group-join" is otherwise unfalsifiable from the outside — the code would look right and a regression (someone reintroducing `subscribe()`) would pass every existing test. These two are the tripwires, in the spirit of P27's D24: they assert the *cause*, not a timing. |
| D31 | **`tests/ui/kafka.spec.ts` keeps its assertions and gains nothing**; it is re-run as the end-to-end guard that the rewritten adapter still feeds the stream view (`:173` still finds `seed` in the headers column). | It is the only test that exercises the driver inside a real Electron `utilityProcess` at ABI 148 — which is the configuration the shipped app runs end to end — the adapter suite (D27) exercises the same ABI but not the real `utilityProcess`, the MessagePort or the stream view. Its value here is that it is unchanged: if the seed swap (D26) and the adapter rewrite are both correct, this file passes untouched. |

### Topic E — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D32 | **No wire, renderer, IPC, storage or cache change.** `StreamPage`, `KafkaStreamFilter`, the offset-window page token, `data.read` and the L2 cache key are untouched. | The phase is a driver swap plus one loop rewrite; keeping the wire fixed is what lets `tests/ui/kafka.spec.ts` and the stream view act as an untouched regression surface, and means no L2 invalidation on upgrade. |
| D33 | **SQS is out of scope entirely, and the plan says so in `docs/v1/SPEC.md`'s P32 row when it is updated.** | The user's note names Kafka only; SQS uses `@aws-sdk/client-sqs`, shares no client code, and `sqs/read.ts` never reads the Kafka stream filter (`shared/domain/streamFilter.ts:5-8`). The only thing the two share is the `StreamPage` shape, which D32 freezes. |
| D34 | **SPEC.md edits are made by the implementing session:** §5.1's Kafka row cancel mechanism (`:186`) becomes *"close the assigned consumer, `AbortSignal`"*; §8.11's Kafka topic definition sentence (`:507`) gains the DescribeConfigs caveat; §11's `tests/` layout gains `electron-db/` with one line saying why it exists (D27); §10's P32 row (`:695`) gets its outcome column **only once implemented**. §3's driver line (`:99-101`) finally becomes true and needs no edit. | Standing practice (P27 D34, P24 D41, P22 D11): the phasing table records what shipped, and the plan does not pre-write it. |
| D35 | **Every step keeps `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` green, and the phase is not done until `bun run test:db` and `xvfb-run -a bun run test:ui` are green on the macOS/Colima box.** | AGENTS.md's Docker note (`:43-48`) plus F20: neither the container suites nor the Electron-ABI build can happen in Claude Code's Linux web container. Saying "tests pass" on the strength of a typecheck would be the exact shortcut §0 forbids. |

## 4. Implementation order

Each step is one commit and must leave lint, typecheck (all three projects) and build green.
Steps 1–2 are the environment gate, 3–8 the adapter, 9–11 the tests and fixtures, 12 the docs.

1. **`chore(kafka): build the confluent driver for electron's ABI and prove it loads`** — no
   production code, and **this step happens on the macOS/Colima box** (F20: Electron's headers host
   is proxy-blocked in Claude Code's Linux web container). Add the dependency and
   `trustedDependencies` (D1/D2), `bun install`, then record in the commit message:
   (a) `electron-rebuild --only @confluentinc/kafka-javascript` completing, and
   `ELECTRON_RUN_AS_NODE=1 electron -e "const k=require('@confluentinc/kafka-javascript'); console.log(k.librdkafkaVersion, k.features.join(','))"`
   printing `2.15.0` and a feature list **containing `ssl`, `sasl`, `sasl_plain` and `sasl_scram`**
   — a from-source build silently drops SSL/SASL if OpenSSL headers are missing, which would break
   every secured connection while every test against a plaintext container still passed;
   (b) `ELECTRON_RUN_AS_NODE=1 electron -e "console.log(typeof require('node:test').test)"` —
   D28's one open mechanical question, answered before the conversion is written.
   The Bun half needs no probe: F21 settled it in the planning container, at both the mismatched and
   the matching ABI.
2. **`build(kafka): install the native driver and teach packaging about it`** — `package.json`
   (dependency added, `kafkajs` removed, `trustedDependencies`, `@electron/rebuild` as a
   devDependency, the `pre*` script wiring, `test:db:kafka`),
   `scripts/native-electron-build.sh`, `electron-builder.yml` (`asarUnpack` + `files` exclusions +
   the corrected `npmRebuild` comment), and `scripts/verify-packaging.sh`'s new A6 check
   (D1, D2, D5, D6, D7).
   The tree does not compile at the end of this step only if step 3 is not in the same series — so
   land 2 and 3 back to back and keep 2 mechanical.
3. **`refactor(kafka): one librdkafka config, admin and producer on the compat API`** —
   `client.ts` rewritten to `RdConfig` + `KafkaClientHandle` (D12), `index.ts`'s connect/disconnect
   with the metadata probe and the new `ConnectInfo` (D13), `produce.ts` on the compat producer with
   `linger.ms: 0` (D11). `read.ts` still compiles against the handle's admin.
4. **`refactor(kafka): classify driver errors by librdkafka code`** — `errors.ts` per D17, including
   the `E_AUTH` widening and the preserved unknown-topic → `E_QUERY` call.
5. **`refactor(kafka): catalog reads the new metadata shape`** — `catalog.ts` for the array-returning
   `fetchTopicMetadata` and the internal-topic filter applied before describing (F15.1, D9).
6. **`feat(kafka): browse with manual partition assignment, no consumer group`** — the core commit.
   `read.ts`: the native browse consumer, `assign()` with start offsets, the bounded poll loop, the
   EOF/empty-poll termination, `disconnect()` on abort, the header fold and the offset guard
   (D19–D24). `freshWindows`/`countTopic`/the token untouched (D20). `caps.ts`'s cancel comment
   updated.
7. **`feat(kafka): group state and type names in the definition view`** — `definition.ts`'s group
   half (D15), plus the enum name lookups.
8. **`fix(kafka): the topic definition says why its configuration is empty`** — `definition.ts`'s
   topic half (D14), the `ConfigResourceTypes` import and mask removed.
9. **`test(kafka): seed the fixture through the broker's own CLI`** —
   `tests/db/fixtures/0005_kafka_seed.ts` and `tests/db/support/kafka.ts` per D26, keeping every
   exported constant (`ORDERS_TOPIC`, `ORDERS_MESSAGE_COUNT`, …) so both spec files' imports are
   unchanged. This is the commit that removes the last JS Kafka client from any non-Electron
   process, so it must land before step 10 moves the suite.
10. **`test(kafka): run the adapter suite under electron-as-node`** — `tests/db/kafka.spec.ts`
    moves to `tests/electron-db/kafka.spec.ts`, converts to `node:test` + `node:assert/strict`, and
    gains the esbuild bundle step and the `test:db:kafka` script (D27/D28). Acceptance: the 16
    existing scenarios pass **with their assertions unchanged in substance**, still against
    `cp-kafka:7.6.1` — so a failure here is the runner move, not Kafka 4. `bun run test:db` (the
    other engines) stays green and no longer collects a Kafka file.
11. **`test(kafka): run the fixture against a Kafka 4 broker, and cover the group-less browse`** —
    the image bump to `cp-kafka:8.0.x` and its comment (D25), scenarios 17–20 (D30) and the F25
    assertion updates (D29). This is the first point where the whole stack is exercised against
    Kafka 4; run `bun run test:db`, `bun run test:db:kafka` and `bun run test:ui` on the macOS box.
12. **`docs: SPEC.md, PACKAGING.md, PERF.md and AGENTS.md for P32`** — D4, D8, D18, D34 (not the
    §10 outcome column, which is written once the phase is verified green).

## 5. Tests

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| `tests/db/kafka.spec.ts:93-94` | `describeCluster` is gone (F11); `details.cluster` no longer exists. | Keep `serverVersion === 'Kafka'`; assert `details.brokers` is a non-empty numeric string and `details.librdkafka` matches `/^\d+\.\d+\.\d+/` (D13). |
| `tests/db/kafka.spec.ts:192-197` | `describeConfigs` is gone (F11/D14). | Keep the two section titles; assert the Configuration section has zero rows **and** that `topicDef.notes` contains a line explaining why. Deleting the assertion would let the note silently disappear. |
| `tests/db/kafka.spec.ts:199-214` | The group definition gains rows (D15) and the seed now creates the group via CLI (D26). | Section titles unchanged; add assertions that the Group section's `state` row reads a **name** (`/^[A-Za-z ]+$/`, not a digit) and that committed offsets still cover both partitions. |
| `tests/db/kafka.spec.ts:334-357` (scenario 11) | The retry/backoff comment describes kafkajs's retry budget, which no longer exists. | Rewrite the comment for librdkafka's metadata timeout; keep `E_QUERY` (D17) and re-check whether the 20 s allowance is still needed — if librdkafka fails faster, shrink it rather than leaving a stale number. |
| `tests/db/kafka.spec.ts:400-434` (scenarios 14–15) | Cancellation's mechanism changed (D22). | No assertion change: `cancel()` is still `false` and an already-aborted signal still yields `E_CANCELLED`. These two are the guard that D22 did not weaken cancellation, so they must pass **unchanged**. |
| `tests/db/fixtures/0005_kafka_seed.ts`, `tests/db/support/kafka.ts` | D25/D26. | Seed via container `exec`; image bumped to CP 8.0.x. Every exported constant keeps its name and value so both consuming specs are untouched by this. Both files stay under `tests/db/` and stay client-free, because the moved suite (D27) and `tests/ui/kafka.spec.ts` both import them from different runtimes. **Verify on the container** that `kafka-consumer-groups --reset-offsets --to-earliest --execute` against a group that has never existed does create committed offsets rather than erroring — it is the one CLI behaviour in D26 that is asserted rather than read from a manual. |
| `tests/db/kafka.spec.ts` → `tests/electron-db/kafka.spec.ts` | Bun cannot load the driver (F21/D27). | Whole file moves and converts to `node:test` + `node:assert/strict` (D28); scenario names, order and substance unchanged, so the diff is reviewable as a mechanical conversion. `tests/electron-db/tsconfig.json` mirrors `tests/db/tsconfig.json` (`include: ["**/*.ts", "../db/support/**/*.ts", "../db/fixtures/**/*.ts"]`, the same `@shared/*` path, `types: ["node"]` instead of `["bun-types"]`) and `typecheck:db` becomes two `tsgo` invocations so the moved suite stays type-checked rather than quietly dropping out of `bun run typecheck`. |
| `tests/ui/kafka.spec.ts` | Nothing — it must pass unchanged (D31). | **No change permitted.** It is the only coverage of the driver inside a real Electron `utilityProcess`; if a testid or wait has to move, the adapter rewrite changed something it promised not to. |
| `scripts/verify-packaging.sh` | A native production dependency now has to survive packaging (D7). | New check A6: `app.asar.unpacked/node_modules/@confluentinc/kafka-javascript/build/Release/*.node` exists in a built `.app`, and no `.node` is inside `app.asar`. |

### New coverage

**`tests/electron-db/kafka.spec.ts`, appended to the moved describe** (same container, same seed —
D27):

- **17. a browse joins no consumer group** (D19/D30). Page through `ORDERS_TOPIC` at
  `pageSize: 2` until `hasMore` is false — several browses, several consumers — then call
  `adapter.children(path([]))` and assert the returned `consumerGroup` nodes are exactly
  `[CONSUMER_GROUP]`: no `kira-studio-browse` group exists, and no group was created by browsing.
- **18. a browse commits no offsets** (D19/D30). After scenario 17's browse, assert that the
  group definition for `kira-studio-browse` either does not exist (`E_NOT_FOUND`) or carries no
  committed offsets for `ORDERS_TOPIC` — the structural form of P10 D6's promise that browsing
  leaves no trace in `__consumer_offsets`.
- **19. a timestamp filter still seeks** (D20, guarding the one `freshWindows` path no existing
  scenario covers). Browse `ORDERS_TOPIC` with a `KafkaStreamFilter` whose `timestampMs` is between
  two seeded messages; assert the returned messages are exactly the ones at or after it. This
  exercises `admin.fetchTopicOffsetsByTimestamp` on the new client, which is the call P10's own
  `read.ts:49-56` comment describes as the reason the adapter avoids a consumer-side seek dance.
- **20. an oversized start offset is refused, not truncated** (D23). Hand-craft a page token whose
  window `next` exceeds `Number.MAX_SAFE_INTEGER`; assert `E_UNSUPPORTED` with a message naming the
  offset — a unit-shaped scenario that needs no special broker state.

**No new spec *file*** — scenarios 17–20 are appended to the moved suite, so the move (step 10) and
the new coverage (step 11) stay separately reviewable: step 10's diff is a conversion with no
behaviour change, step 11's is new assertions with no conversion noise.

### What cannot be verified in Claude Code's Linux web container — stated plainly

- **`bun run test:db` cannot run here.** `tests/db/kafka.spec.ts:81` throws when Docker is
  unavailable, and Docker Hub's blob CDN (`production.cloudfront.docker.com`) is blocked by the
  outbound network policy, so no image layer can ever be fetched (`AGENTS.md:43-48`). This is a
  network-policy limit, not a configuration problem, and no amount of `dockerd` fiddling changes it.
- **`xvfb-run -a bun run test:ui` cannot run the Kafka spec here** for the same reason (it skips
  cleanly, `tests/ui/kafka.spec.ts:26-31`), and after this phase it additionally cannot run the app
  against Kafka at all here, because the Electron-ABI build of the driver cannot be produced (F20).
- **`bun run test:db:kafka` cannot run here either**, for two independent reasons: the container
  (above) and the fact that the Electron-ABI build the runner loads cannot be produced here (F20).
- **What *can* be verified here:** `bun install` with the new dependency, `lint`, `typecheck` (all
  projects, including the moved suite), `build`, the electron-builder `--dir` build minus the native
  rebuild, and — usefully — a *Node*-ABI load of the driver via `node-pre-gyp install` in a scratch
  directory, which is how F10–F17's API shapes were confirmed and how a future reader can re-confirm
  them without a broker.
- **What must be run on the macOS/Colima box before this phase is called done:** step 1's two
  Electron probes, `bun run test:db` (the other engines), `bun run test:db:kafka` against the Kafka 4
  container, `bun run test:ui`, `bun run package:mac:dir` + `bun run verify:packaging`, and one
  manual browse of a real topic in the running app.

## 6. Explicitly out of scope

- **SQS, S3 and every other adapter** (D33). Nothing in this phase touches them.
- **Any new Kafka feature**: tail/bidirectional browsing (P10's D7 forward-only rule stands), a
  Kafka query console (`caps.sql` stays `false`, P10 D13), consumer-group offset editing, topic
  creation/deletion, ACL views, Schema Registry decoding. The new client exposes `deleteTopics`,
  `deleteGroups` and `deleteTopicRecords`; this phase wires up none of them.
- **Restoring topic configuration by another route** (D14). Wrapping librdkafka's
  `rd_kafka_DescribeConfigs` is upstream work in a C++ binding, not adapter work, and shelling out
  to `kafka-configs` from a desktop client is not a thing this app does.
- **A long-lived producer, or a pooled/reused browse consumer.** P10's D17 chose ephemeral clients
  deliberately; making them long-lived is a lifecycle change with cancellation and
  connection-limit consequences that deserves its own measurement, not a ride-along.
- **Re-running P12's memory suite** (D4). A native module changes the engine's memory profile and
  P12's levers were measured against a pure-JS driver set — but re-deriving those numbers is P12's
  methodology, and this phase only records the structural fact.
- **Bun's NAN support itself.** F21 is a verified upstream gap (`v8::FunctionTemplate::SetClassName`
  is not implemented by Bun's V8 shim); this phase routes around it (D27) and does not patch, shim
  or vendor anything. If Bun ever closes it, moving the suite back is a smaller change than the one
  this phase makes.
- **Moving the other `tests/db` suites off Bun.** Postgres, MariaDB, Mongo, Redis, SQS and S3 all use
  pure-JS drivers that Bun loads fine; only Kafka has a native driver, so only Kafka moves. A
  wholesale runner migration would be a repo-wide change with no Kafka benefit.
- **A second Kafka connection kind** (e.g. "Confluent Cloud" with OAUTHBEARER). The client supports
  `sasl.oauthbearer` and the connection dialog has no surface for it; adding one is a P1-shaped
  change to the connection schema.
- **`sslmode` semantics.** `client.ts:41-49` currently treats `require`/`prefer`/`verify-full`
  identically (encrypt, verify), and this phase reproduces that behaviour exactly on
  `security.protocol`. Mapping `require` onto
  `enable.ssl.certificate.verification: false` to match libpq would be a *security-relevant*
  behaviour change, and a driver swap is the wrong commit to smuggle one into. §9 asks the question.
- **CA-certificate configuration** (`ssl.ca.location`). No connection field feeds it today; a
  cluster needing a private CA is unsupported before and after this phase.

## 7. Target tree at the end of P32

```
package.json                        MOD  +@confluentinc/kafka-javascript@1.10.0 (dependencies),
                                         -kafkajs, +@electron/rebuild (devDependencies),
                                         +trustedDependencies entry, +test:db:kafka, pre* wiring
                                         for scripts/native-electron-build.sh, typecheck:db covers
                                         both test projects (D1/D2/D6/D27/D28)
electron-builder.yml                MOD  asarUnpack += the .node; files exclusions for deps/src/
                                         obj.target; npmRebuild comment corrected (D5/D7)
scripts/
  native-electron-build.sh          NEW  one ABI (Electron's): marker + cache + electron-rebuild (D6)
  verify-packaging.sh               MOD  A6: the .node is present and unpacked (D7)
src/engine/adapters/kafka/
  client.ts                         MOD  RdConfig + KafkaClientHandle; one librdkafka config for
                                         admin, producer and browse consumer (D12)
  index.ts                          MOD  connect() probe + new ConnectInfo.details; handle passed
                                         to read/produce; cancel() comment (D13/D22)
  read.ts                           MOD  native KafkaConsumer, assign()-only browse, bounded poll
                                         loop, EOF/empty-poll termination, header fold, offset
                                         guard; freshWindows/countTopic/token unchanged (D19-D24)
  produce.ts                        MOD  compat producer + linger.ms: 0 (D11)
  catalog.ts                        MOD  array-shaped fetchTopicMetadata; internal topics filtered
                                         before describing (D9)
  definition.ts                     MOD  group state/type names + assignor + coordinator; topic
                                         configuration section empty with a note (D14/D15)
  errors.ts                         MOD  classification by librdkafka code (D17)
  caps.ts                           MOD  comment only — cancel mechanism (D16/D22)
src/engine/adapters/registry.ts     MOD  comment only — driver name (D18)
src/shared/domain/
  streamFilter.ts                   MOD  comments only — two kafkajs references (D18)
  tabs.ts                           MOD  comment only — one kafkajs reference (D18)
src/renderer/**                      --  UNCHANGED (D32)
src/shared/protocol/page.ts          --  UNCHANGED (D32)
tests/
  db/support/kafka.ts               MOD  cp-kafka:8.0.x; no JS client in the fixture (D25/D26)
  db/fixtures/0005_kafka_seed.ts    MOD  seeded through the container's own CLI (D26)
  db/kafka.spec.ts                  DEL  moves to tests/electron-db/ — bun cannot load the
                                         driver (F21/D27)
  electron-db/kafka.spec.ts         NEW  the same 16 scenarios on node:test + node:assert/strict,
                                         plus 17-20; F25's four assertions updated (D27-D30)
  electron-db/tsconfig.json         NEW  mirrors tests/db/tsconfig.json, types: ["node"] (D28)
  ui/kafka.spec.ts                   --  UNCHANGED — the Electron-ABI end-to-end guard (D31)
docs/
  v1/SPEC.md                        MOD  §5.1 cancel column, §8.11 caveat, §11's tests/ layout
                                         gains electron-db/, §10 P32 outcome once
                                         implemented (D34)
  v1/PACKAGING.md                   MOD  §2's npmRebuild bullet, the new unpack entry (D8)
  v1/PERF.md                        MOD  one note: the Kafka driver is native and not reclaimable
                                         once loaded (D4)
  v1/plans/P32-kafka-client-migration.md   NEW  this document
AGENTS.md                           MOD  new "Native Kafka driver (librdkafka)" section: Electron's
                                         ABI only (never bun), native-electron-build.sh, the
                                         test:db:kafka runner, and F20's blocked-headers finding (D8)
```

## 8. Acceptance checklist

**The client swap**

- [ ] `grep -rn "kafkajs" src/ tests/ package.json` returns **nothing** — not an import, not a
      dependency, not a stale comment.
- [ ] A Kafka connection connects, and the connection tooltip shows a broker count and a librdkafka
      version; a wrong host fails at connect with `E_CONNECT`, not on first tree expand.
- [ ] The tree lists topics with their partition counts and consumer groups, both sorted, with
      internal (`__`-prefixed) entries hidden.
- [ ] A topic's definition tab shows its Partitions section; its Configuration section is empty and
      carries a note saying why. A consumer group's definition shows a **named** state (not a
      digit), its type, members and committed offsets.
- [ ] Producing a message from the stream view still lands it in a fresh browse, and a read-only
      connection still refuses with `E_UNSUPPORTED`.

**The group-less browse**

- [ ] Browsing a topic — first page, several token-continued pages, and a filtered browse — never
      creates a consumer group: `listGroups()` after the browse shows only pre-existing groups.
- [ ] Browsing leaves no committed offsets under any `kira-studio-*` group.
- [ ] `grep -n "subscribe(" src/engine/adapters/kafka/` returns nothing.
- [ ] Partition, offset and timestamp filters all still position the browse correctly, and paging
      forward through a multi-partition topic still returns every message exactly once.
- [ ] An empty topic returns a terminal empty page rather than blocking for a poll timeout, and a
      browse whose window can never be filled (compacted range) terminates instead of hanging.
- [ ] Cancelling an in-flight browse rejects with `E_CANCELLED` within about one poll interval, and
      `Adapter.cancel()` still returns `false`.

**Kafka 4**

- [ ] `bun run test:db:kafka` runs green against `confluentinc/cp-kafka:8.0.x` (Apache Kafka 4.0) on
      the macOS/Colima box — every existing scenario plus 17–20 — and `bun run test:db` (the six
      other engines) is green and no longer collects a Kafka file.
- [ ] The seed creates topics, messages with headers, and a consumer group with committed offsets
      **without** any JavaScript Kafka client.
- [ ] `tests/ui/kafka.spec.ts` passes unchanged, against the same Kafka 4 container, with the app's
      engine loading the Electron-ABI build.

**Native module and packaging**

- [ ] Step 1's Electron probes are recorded in the repo history, including the `features` list —
      `ssl`, `sasl`, `sasl_plain` and `sasl_scram` present, i.e. the from-source build did not
      silently drop the security features the prebuilt binaries carry.
- [ ] `bun run dev` starts and a Kafka connection works — i.e. the Electron-ABI build is in place
      and `scripts/native-electron-build.sh` is idempotent on a second run (second run does no work).
- [ ] Running `test:db`, `test:db:kafka`, `test:ui` and `dev` in any order needs no manual rebuild,
      and a fresh `bun install` followed by one of them produces a working driver.
- [ ] `bun run package:mac:dir` produces an `.app` whose `app.asar.unpacked` contains the `.node`,
      whose `app.asar` contains none, and whose size is still under the 300 MB L-D budget;
      `bun run verify:packaging` passes including the new A6.
- [ ] AGENTS.md tells the next agent, before they hit it, that the Electron-ABI build cannot be
      produced in Claude Code's Linux web container.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (every project, the moved suite included) and
      `bun run build` clean.
- [ ] SPEC.md §5.1, §8.11 and §11 describe what shipped; §10's P32 row is filled in last.

## 9. Open questions for the user

1. **Is losing the topic Configuration section acceptable, and should it stay visible-but-empty or
   disappear?** D14 keeps the section with an explaining note because P23 specified it
   (`docs/v1/SPEC.md:507`) and an empty-with-a-reason section is more honest than a silently missing
   one. The alternative is dropping the section entirely so the tab shows only Partitions. Keeping
   `kafkajs` alive purely for `DescribeConfigs` is not offered — see §0.
2. **`cp-kafka:8.0.x` (Apache Kafka 4.0) or a later 8.x (4.1/4.2/4.3)?** D25 pins the 8.0 line
   because it is the first Kafka that removed the old protocol versions, which is the compatibility
   edge this phase exists for. Testing against the newest 8.x instead would track "current Kafka"
   rather than "the Kafka 4 boundary" — one image tag either way, and the fixture can carry only one.
3. **Should `sslmode: require` stop verifying the server certificate, matching libpq?** Today all
   three non-disable modes verify (`client.ts:41-49`), and §6 keeps that. librdkafka can express the
   libpq semantics exactly (`enable.ssl.certificate.verification: false` for `require`), which would
   make Kafka's `sslmode` consistent with Postgres's — at the cost of a security-relevant behaviour
   change landing inside a driver swap. Worth doing as its own small change if the consistency
   matters.
4. **The Kafka adapter suite has to leave `bun test` — is the Electron-as-Node runner (D27/D28) the
   right destination?** This is no longer conditional: F21 verified that Bun cannot load the addon
   at *any* ABI, so `bun test` and this driver cannot coexist. What remains a choice is where the 16
   scenarios go. D27 moves them to `tests/electron-db/` under `ELECTRON_RUN_AS_NODE=1 electron`,
   which costs one mechanical conversion, one esbuild bundle step, one script and one `tests/`
   directory — and buys coverage in the exact runtime the shipped engine uses. The alternatives:
   (a) leave the adapter suite behind and rely on `tests/ui/kafka.spec.ts`, which loses the
   error-code, cursor, cancellation and read-only scenarios and both group-less tripwires — not
   recommended; (b) keep the whole `tests/db` tree but run *all* of it under Electron-as-Node, which
   is a repo-wide change six other engines do not need.
5. **Should the connection tooltip show the broker list rather than a count?** D13 reports
   `brokers: "3"` plus the librdkafka version because `details` is free-form and currently unread by
   the UI. Listing `id@host:port` for each broker is the same one line of code and is genuinely
   useful when a bootstrap address differs from the advertised listeners — it is just noisier.
