# P37 — The RabbitMQ adapter: a broker you browse over HTTP

> SPEC.md §10's **P37** row, verbatim:
>
> *"A new adapter and view for RabbitMQ (exchanges, queues, bindings), alongside the existing
> Kafka/SQS stream adapters, with its own `tests/db/rabbitmq.spec.ts` against a RabbitMQ
> testcontainer"*, with the rationale *"Not yet planned — queued. Whether RabbitMQ's model fits the
> existing stream view (P10) or needs its own page kind is an open question for that plan."* This
> plan answers that question, and the answer is **it fits the existing `stream` page kind, on SQS's
> half of it, not Kafka's** — and the part of RabbitMQ that does *not* fit (exchanges, bindings,
> policies, arguments) belongs in the definition view, exactly where P23 already put a Kafka topic's
> partitions.
>
> **The finding the phase turns on.** AMQP 0-9-1 cannot enumerate anything. There is no
> "list queues", no "list exchanges" and no "list bindings" in the protocol — `queue.declare` with
> `passive` only probes a name you already know, and exchanges cannot be probed at all (F2). Every
> object this phase exists to show is visible **only** through the `rabbitmq_management` plugin's
> HTTP API (F4, F7). So the protocol question is not "AMQP or HTTP": HTTP is mandatory, and the only
> live question is whether AMQP is worth adding *beside* it. D2 says no, for the same reason P32's
> ground rules said one driver and not two.
>
> **The second finding, and the one that makes the phase cheap.** The management API is plain REST
> over HTTP basic auth, and the engine's runtime already speaks it: Electron 43.4.1 runs Node
> 24.18.1 with a global `fetch` and `AbortSignal.timeout`, and Bun (what `bun test tests/db` uses)
> has both too — probed in this container, not assumed (F5). **P37 therefore adds no production
> dependency at all** — the second phase after P35's `node:sqlite` to add an engine for free, and
> the first adapter in this tree to speak HTTP by hand (F6).
>
> **The third finding, and the one that shapes every write decision.** A RabbitMQ message has no
> identity. `message_id` is an optional, publisher-set property; the only handle the broker issues is
> a per-channel *delivery tag*, valid only on the channel that received it and gone when that channel
> closes (F22). There is no per-message delete and no update — removal means consuming, and the only
> broker-side bulk removal is a queue-wide purge (F25). So `canInsert: true, canUpdate: false,
> canDelete: false`: Kafka's exact shape (`kafka/caps.ts:24-31`) reached for a third distinct
> structural reason, and one flag *narrower* than SQS, whose receipt handle really does address one
> message.
>
> **The fourth finding, and the one that makes reading honest.** The management API's
> `POST /api/queues/{vhost}/{name}/get` is a real `basic.get` loop with a real acknowledgement mode
> (F10, F11) — the plugin's own documentation calls it *"a sysadmin's tool rather than a general API
> for messaging"*. With `ackmode: reject_requeue_true` nothing is removed, but the messages are
> genuinely delivered and then requeued: RabbitMQ puts a requeued message back *"to its original
> position in its queue, if possible"* and otherwise *"closer to queue head"* (F12), and the
> redelivered flag is set. That is not a free browse, and it is not SQS's "the message disappears for
> the visibility timeout" either. §5.1's SQS read policy — poll on demand, never automatic, with the
> warning visible — extends to RabbitMQ verbatim; only the sentence in the warning strip changes
> (D32).

## 0. Ground rules for this phase

- **No new production dependency, and no smuggled second protocol.** The adapter is `fetch` plus
  JSON. `amqplib`, `rabbitmq-client` and `amqp-connection-manager` are all evaluated in §1 and all
  rejected in D2/D3 — not for size, but because adding AMQP would mean a second port, a second
  credential path, a second failure mode and a second set of capabilities to keep honest, in
  exchange for two operations this app does not offer (destructive consume, high-throughput
  publish).
- **The user's broker is not ours to change.** No `PUT` of queues, exchanges, bindings, policies,
  users or vhosts; no `DELETE` of anything, including `/contents` (purge). This is P35's "the user's
  file is not ours to change" and P36's "the user's schema is not ours to change", restated for a
  broker. §1's *"DDL is read-only"* covers the topology; there is no console here to type it into
  either (`caps.sql` is false).
- **Absent capabilities are declared, not simulated.** `canUpdate: false`, `canDelete: false`,
  `exactCount: false`, `describe: false`, `sql: false`, `projection: false`, `serverFilter: false`,
  `foreignKeys: false`, `transactions: false`, `fileTransfer: false`, `pagination: 'batch'`. Each has
  a finding behind it. `cancel` is **not** one of them (D7).
- **Nothing silently dropped, nothing silently reordered.** A poll that clamps its page size says so;
  a payload the broker truncated is marked truncated in the page (D22); a publish the broker routed
  nowhere is an error, not a success (D25); a queue type that cannot be `basic.get`'d says which one
  it is, in the broker's own words (D24).
- **A credential never reaches disk.** `ctx.setCommand()` text is persisted to `op_log.command`
  (F40) and shown in the operations panel, so the adapter never puts credentials in a URL and never
  logs a request body containing one. Basic auth travels in an `Authorization` header built once per
  connection (D6).
- **Preview and execution are the same text.** §8.14's rule, applied to a REST adapter: `preview()`
  renders `POST <path>` plus the exact JSON body `mutate()` will send, byte for byte (D25).
- Comments per `AGENTS.md`: only where the code cannot say it for itself — in particular D8's
  `%2F` rule, D15's hidden default exchange, D22's `MAX_CELL_BYTES + 1` truncation trick, D25's
  `amq.default` spelling, and D26's "why there is no delete". None of those is re-derivable from the
  code.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every commit.
  `tests/db/rabbitmq.spec.ts` **needs Docker**, so per `AGENTS.md` it cannot be executed in Claude
  Code's Linux web container; items that depend on a live broker are flagged **verify-on-container**
  in §8, exactly as P34/P36 flagged theirs.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings

F1–F20 are RabbitMQ, client and package facts, each read from the npm registry, the
`rabbitmq/rabbitmq-server` tree, the `rabbitmq/rabbitmq-website` docs source, Docker Hub's tag list,
or probed from this container. F21–F25 are protocol/engine facts. F26–F40 are facts about this tree,
measured against it. Where a fact could only be confirmed against a running broker it is called out
and lands in §8's verify-on-container list.

### The client question

**F1 — `amqplib` is healthy, dependency-free and typed, and still cannot do the job.** npm registry:
`amqplib@2.0.1` (published 2026-05-10), `"dependencies": {}`, `"engines": {"node": ">=18"}`, MIT,
and — new in the 2.x line — it ships its own `index.d.ts` via `exports`, so `@types/amqplib` (still
at 0.10.8, for the 0.10 line) is no longer needed. Nothing about the package is the problem; F2 is.

**F2 — AMQP 0-9-1 has no enumeration.** The protocol's queue class is `declare` / `bind` / `unbind`
/ `purge` / `delete`, and its exchange class is `declare` / `delete` — there is no "list" method for
either, and no method that returns bindings. `queue.declare` with `passive: true` only answers
"does *this* name exist, and how many messages/consumers does it have", for a name the client
already has; on a miss it closes the channel with a 404. So an AMQP-only adapter could show an empty
tree and nothing else: no vhost list, no queue list, no exchange list, no bindings, no policies, no
arguments.

**F3 — the other JS clients are the same protocol, wrapped.** `rabbitmq-client@5.0.8` (typed,
zero-dependency, 0-9-1) and `amqp-connection-manager@5.0.0` (a reconnect wrapper with an `amqplib`
peer dependency) are both AMQP 0-9-1 only, so F2 applies to them unchanged. There is no JS client
for RabbitMQ's *stream* protocol in scope here either, and it would not help: it addresses stream
queues only, and still enumerates nothing.

**F4 — the management HTTP API is the only enumeration surface, and it is ordinary REST.** The
plugin's own reference (`deps/rabbitmq_management/priv/www/api/index.html`, served at
`/api/index.html` by every management-enabled node) opens: *"Apart from this help page, all URIs will
serve only resources of type `application/json`, and will require HTTP basic authentication (using
the standard RabbitMQ user database). The default user is guest/guest."*

**F5 — the runtimes this app actually uses already speak it.** Probed in this container:
`ELECTRON_RUN_AS_NODE=1 electron -e "console.log(process.versions.node, typeof fetch, typeof
AbortSignal.timeout)"` prints `24.18.1 function function` for the pinned `electron@43.4.1` — the
exact runtime the engine `utilityProcess` is. Bun (which `bun test tests/db` runs under) has both
globals as well. No polyfill, no HTTP library, no `node:http` hand-rolling.

**F6 — no adapter in this tree uses `fetch` today.** `grep -rn "fetch(" src/engine src/main` returns
nothing: `@aws-sdk/client-s3`/`-sqs` bring their own request handler, `@clickhouse/client` builds on
`node:http`, and everything else is a wire-protocol driver. RabbitMQ is therefore this tree's first
raw-HTTP adapter, which is a reason to confine every call to one function (D8), not a reason to add
a library.

### The management HTTP API

**F7 — the endpoint inventory this adapter needs**, all from F4's reference:
`GET /api/overview` (broker + management versions, node, cluster name) · `GET /api/vhosts` ·
`GET /api/queues/{vhost}` · `GET /api/queues/{vhost}/{name}` · `GET /api/queues/{vhost}/{name}/bindings`
(*"A list of all bindings on a given queue"*) · `POST /api/queues/{vhost}/{name}/get` ·
`DELETE /api/queues/{vhost}/{name}/contents` (purge — *"Note you can't GET this"*) ·
`GET /api/exchanges/{vhost}` · `GET /api/exchanges/{vhost}/{name}` ·
`GET /api/exchanges/{vhost}/{name}/bindings/source` · `.../bindings/destination` ·
`POST /api/exchanges/{vhost}/{name}/publish` · `GET /api/bindings/{vhost}` · `GET /api/policies/{vhost}` ·
`GET /api/whoami` · `GET /api/definitions/{vhost}`.

**F8 — the vhost is a path segment and the default vhost is named `/`.** The reference, verbatim:
*"Many URIs require the name of a virtual host as part of the path, since names only uniquely
identify objects within a virtual host. As the default virtual host is called `"/"`, this will need
to be encoded as `"%2F"`."* Its own worked example is
`PUT http://localhost:15672/api/exchanges/%2F/my-new-exchange`.

**F9 — the list endpoints are paginated, capped and trimmable.** `page`, `page_size`
(*"default value: 100, maximum supported value: 500"*), `name` and `use_regex` apply to queues,
exchanges, connections and channels; `sort`/`sort_reverse`/`columns` apply to every list; and
`disable_stats=true` plus `enable_queue_totals=true` on the queues endpoints *"return a reduced set
of fields and significantly reduce the amount of data returned… CPU and bandwidth footprint"*. The
reference repeats, per endpoint: *"this endpoint can produce very large JSON responses and waste a
lot of bandwidth and CPU resources."*

**F10 — the read endpoint, in the plugin's own words.** `POST /api/queues/{vhost}/{name}/get`, body
`{"count":5,"ackmode":"ack_requeue_true","encoding":"auto","truncate":50000}`. *"`ackmode` determines
whether the messages will be removed from the queue. If ackmode is `ack_requeue_true` or
`reject_requeue_true` they will be requeued — if ackmode is `ack_requeue_false` or
`reject_requeue_false` they will be removed. `encoding` must be either `"auto"` (in which case the
payload will be returned as a string if it is valid UTF-8, and base64 encoded otherwise), or
`"base64"`… If `truncate` is present it will truncate the message payload if it is larger than the
size given (in bytes)."* And, decisively for §5.1's read policy: *"the get path in the HTTP API is
intended for diagnostics etc — it does not implement reliable delivery and so should be treated as a
sysadmin's tool rather than a general API for messaging."*

**F11 — the exact response shape, and the batch's exact mechanics**, read from
`deps/rabbitmq_management/src/rabbit_mgmt_wm_queue_get.erl` rather than inferred. Per message:
`payload_bytes`, `redelivered`, `exchange`, `routing_key`, `message_count`, `properties`, `payload`,
`payload_encoding` — `delivery_tag` is present internally and **stripped before the reply**
(`remove_delivery_tag/1`). `payload_bytes` is `size(Payload)` computed **before** `maybe_truncate`,
so it is always the message's true size. The endpoint opens one server-side channel
(`with_channel`), issues `Count` sequential `basic.get`s, and only afterwards rejects/nacks the whole
batch — with a source comment saying why: *"the messages must rejects later, because we get always
the same message if the messages are requeued inside basic_get/5"*. So one poll returns up to
`count` **distinct** messages.

**F12 — requeue is not free, and the docs say exactly how it is not.**
`rabbitmq-website/docs/confirms.md`: *"When a message is requeued, it will be placed to its original
position in its queue, if possible. If not (due to concurrent deliveries and acknowledgements from
other consumers when multiple consumers share a queue), the message will be requeued to a position
closer to queue head."* The redelivered flag is set on the next delivery — which is why F11's
response carries `redelivered` at all.

**F13 — a stream-type queue refuses `basic.get` outright.** `deps/rabbit/src/rabbit_stream_queue.erl`:
```erlang
dequeue(_, _, _, _, _Timeout, #stream_client{name = Name}) ->
    {protocol_error, not_implemented, "basic.get not supported by stream queues ~ts", [...]}.
```
So `POST .../get` against an `x-queue-type: stream` queue fails, with that sentence in the error.
This is a permanent engine fact, not a permission or version issue.

**F14 — the publish endpoint.** `POST /api/exchanges/{vhost}/{name}/publish`, body
`{"properties":{},"routing_key":"my key","payload":"my body","payload_encoding":"string"}` —
*"All keys are mandatory"*, `payload_encoding` is `"string"` or `"base64"`. The response is
`{"routed": true}`, and *"`routed` will be true if the message was sent to at least one queue."* The
doc's own caveat: *"the HTTP API is not ideal for high performance publishing; the need to create a
new TCP connection for each message published can limit message throughput."*

**F15 — the default exchange has no name, and the management surface spells it `amq.default`.**
`priv/www/js/formatters.js`: `fmt_exchange0(name) → name == '' ? '(AMQP default)' : name` and
`fmt_exchange_url(name) → name == '' ? 'amq.default' : …`. `priv/www/js/tmpl/publish.ejs` shows what
"publish to a queue" actually is: for `mode == 'queue'` it posts with `name = "amq.default"` and
`routing_key = queue.name`, over the caption *"Message will be published to the default exchange
with routing key **&lt;queue&gt;**, routing it to this queue."*

**F16 — errors are a machine-readable JSON envelope.** `rabbit_mgmt_util.erl`:
`halt_response(400, bad_request, Reason, …)` builds `#{error => bad_request, reason => ReasonBin}`;
`not_found/3` and `not_authorised/3` do the same at 404 and 401 (`<<"Access refused.">>` is the
literal reason for a permission failure). A missing queue is 404 with reason `queue_not_found`
(`rabbit_mgmt_wm_queue_get.erl`'s `resource_exists/2`).

**F17 — management is a plugin, on its own port.** `rabbitmq_management` must be enabled for any of
F7 to exist; its listener is 15672 (15671 with TLS). A node without it answers nothing on 15672 at
all; the AMQP listener on 5672 is a different protocol that will not answer an HTTP request.

**F18 — the message counts are a snapshot, and sometimes a stale one.** `messages`,
`messages_ready` and `messages_unacknowledged` describe a live queue that any consumer or publisher
can change between one request and the next; on the list endpoints they are served through the
management plugin's statistics database unless `enable_queue_totals=true` bypasses it (F9). There is
no "count as of this exact instant, guaranteed" operation in the API at all.

**F19 — `@testcontainers/rabbitmq` exists at the version this repo already pins.** npm:
`@testcontainers/rabbitmq@12.1.0`, dependency `testcontainers: ^12.1.0` — the exact version
`package.json` pins and the same major as the six `@testcontainers/*` presets already installed.
From its source (`build/rabbitmq-container.js`): the image is a **required** constructor argument
(no default, same as `@testcontainers/clickhouse`), it exposes 5672/5671/15671/15672, sets
`RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS` to `guest`/`guest`, waits on
`Wait.forLogMessage("Server startup complete")` with a 30 s startup timeout, and exposes only
`getAmqpUrl()`/`getAmqpsUrl()` — **there is no HTTP helper and no HTTP wait strategy**.

**F20 — the image line.** Docker Hub `library/rabbitmq`, read 2026-08: `4.3.5-management` /
`4.3.5-management-alpine` (2026-08-21) are current, with `4.2.9` and `4.1.8` as the older supported
lines. The **plain** `rabbitmq:4.3.5` tag has no management plugin enabled — the `-management`
variant is not optional for this adapter.

### RabbitMQ as an engine

**F21 — the object model, and the one object with no name.** A vhost contains exchanges, queues,
bindings and policies. A binding is not a named object: the reference states *"Since bindings do not
have names or IDs in AMQP we synthesise one based on all its properties. Since predicting this name
is hard in the general case, you can also create bindings by POSTing to a factory URI."* A binding
carries `source`, `destination`, `destination_type` (`queue` | `exchange`), `routing_key`,
`arguments` and the synthesised `properties_key`.

**F22 — a message has no identity.** `message_id`, `correlation_id` and `timestamp` are optional
*publisher-set* AMQP properties — a broker never assigns them. The only broker-issued handle is the
per-channel `delivery_tag`, which F11 shows the management API strips from its own reply because it
is meaningless outside the channel that produced it (and that channel is closed by the time the HTTP
response is written).

**F23 — queue types and where their behaviour is declared.** `x-queue-type` is `classic` (default),
`quorum` or `stream`; other arguments in common use are `x-message-ttl`, `x-max-length`,
`x-max-length-bytes`, `x-dead-letter-exchange`, `x-dead-letter-routing-key`, `x-overflow`,
`x-single-active-consumer`. Policies (`GET /api/policies/{vhost}`) apply the same settings by name
pattern; an individual queue's own `policy` and `effective_policy_definition` fields report which one
won, with no second request.

**F24 — the AMQP basic properties, and the absence of a broker timestamp.** `content_type`,
`content_encoding`, `headers`, `delivery_mode`, `priority`, `correlation_id`, `reply_to`,
`expiration`, `message_id`, `timestamp` (**epoch seconds**), `type`, `user_id`, `app_id`. Every one
is set by the publisher; RabbitMQ records no receive time of its own, so a message with no
`timestamp` property has no time the adapter could honestly show.

**F25 — there is no per-message delete and no update.** Removing one message means consuming it
(`ack`) on a channel that was delivered it; the only broker-side bulk removal is
`DELETE /api/queues/{vhost}/{name}/contents` (purge), which is queue-wide. Editing a delivered
message in place does not exist in AMQP at any version.

### The app seam

**F26 — `StreamPage`'s five columns already anticipate a third engine.** `page.ts:130-136`:
*"`keys`/`headers`/`attrs`/`timestamps`/`bodies` are fixed semantic columns… `attrs` is the one
column whose meaning differs per engine (partition/offset JSON for Kafka, system attributes JSON for
SQS, per §8.9)."* `visibilityTimeoutSeconds` is documented in the same comment as SQS-only,
null for Kafka.

**F27 — the stream view already has a "this read is not free" mode, and it is SQS's.**
`StreamView.vue:84` is `const isBatch = computed(() => caps.value?.pagination === 'batch')`, which
gates: no auto-load on mount, the **Poll** button instead of Next, the *"Click Poll to fetch
messages"* empty state, and a `warn` `MessageStrip` whose text is *"Each poll **consumes** messages
from the queue (subject to the visibility timeout above) — it does not browse a stable position."*
`:88-89` are `isKafka`/`isSqs`, computed from `connectionRecord.kind`, and they gate the filter row,
the compose panel and the SQS-only Delete button.

**F28 — the compose panel is a two-kind switch, and the mutation helpers are three functions.**
`StreamComposeMessage.vue:15` is `defineProps<{ tabId: string; kind: 'kafka' | 'sqs' }>()`;
`streamMutations.ts` is `produceKafkaMessage` (`$key`/`$body`/`$headers`), `sendSqsMessage`
(`$body`/`$headers`) and `deleteSqsMessage` (`{ messageId }`). The `$`-sentinel-through-
`MutationRowOp` technique is the same one `redis/mutate.ts` established and `s3/mutate.ts` extended
with `$file`/`$contentType` (P33).

**F29 — the page builder truncates at `MAX_CELL_BYTES`, and only notices its own truncation.**
`page.ts:268-292`'s `appendValue` cuts a value over `MAX_CELL_BYTES` (64 KB) at a UTF-8 boundary and
records the row in `truncatedRows`, which `finish()` turns into the chunk's `truncated` bitset
(`isTruncated`, `:218`). A value the **server** already truncated to exactly the budget arrives under
the limit and is therefore never marked — which is the trap D22 exists to avoid.

**F30 — `grouping.ts` needs three additions and no new mechanism.** `KIND_LABELS` (`:16-36`) is a
total `Record<NodeKind, KindLabel>`; `KIND_LABEL_OVERRIDES` (`:41-47`) already supports a per-
*connection-kind* label override (MariaDB/MySQL's `function` → "Routines"); `GROUPED_KINDS`
(`:64-73`) is the curated folder list P23 extended by one row for `consumerGroup`; `isLeafKind`
(`:110-112`) covers table/view/matview/topic.

**F31 — `icons.ts`'s `KIND_ICON` is a total record.** `:3-23`, one codicon per `NodeKind`, and
`nodeIcon()` must stay total — a new kind without an entry is a type error, which is the good kind
of failure.

**F32 — a leaf in none of `ProjectTree.vue`'s four openable sets is a double-click no-op.** `:30`
`OPENABLE_KINDS = {table, view, matview}`, `:32` `DOCUMENT_OPENABLE_KINDS = {collection}`, `:36`
`KEYVALUE_OPENABLE_KINDS = {key, object}`, `:40` `STREAM_OPENABLE_KINDS = {topic, queue}` — and
`onOpen`'s tail returns early for a childless row in none of them, which is exactly `consumerGroup`'s
standing behaviour (its definition opens from the context menu).

**F33 — `menus.ts`'s per-kind switch ends in `default: return []`.** `:64-98`. A node kind added
without a `case` gets a silently empty context menu, not an error.

**F34 — `connection.ts`'s validation already wants host+port for an ordinary network kind.**
`:92-122`'s `superRefine` requires `host` and `port` in fields mode unless the kind is in
`AWS_STYLE_KINDS` (`:86`) or `FILE_KINDS` (`:90`); `DEFAULT_PORT` (`:20-30`) drives the dialog's
prefill and omits kinds with no conventional port.

**F35 — the URI scheme is the kind's own name.** `uri.ts:36`:
`const scheme = input.kind === 'postgres' ? 'postgresql' : input.kind`, so `rabbitmq://…` falls out
with no change. `canRoundTripToFields` (`:76-95`) is postgres-plus-`FILE_KINDS` only, so a URI-mode
connection of any other kind stays in URI mode — MariaDB's, MySQL's and ClickHouse's standing
behaviour.

**F36 — three per-kind tables in the dialog, and one silent failure mode.**
`ConnectionDialog.vue:23-34` `KIND_LABEL`, `:41-52` `KIND_ACCENT`, `:53-65` `SUPPORTED_KINDS`;
`EngineIcon.vue` is a chain of `v-if="kind === '…'"` with **no fallback**, so an unknown kind renders
an empty `<svg>` with no error in the picker, the tree and the connection rail alike (P36 F43). Its
header states the marks are *"the products' own logos, redrawn to 16px as currentColor paths… not the
vendored trademarked marks"* and 1:1 with `parts/_icons.html`'s `i-*` symbols. Accents in use:
cyan/blue/teal/violet/orange (SQL), green/red (Mongo/Redis), amber/magenta/olive (Kafka/SQS/S3).
**Free: `indigo` `#979fdd` and `grey` `#9fa5ac`.**

**F37 — two capability tables must gain a row.** `shared/caps.ts:100-111`'s per-kind doc table and
SPEC §5.1's own table; nothing reads either at runtime, which is exactly why they drift if a phase
forgets them.

**F38 — the DB-suite harness discipline.** Every `tests/db/*.spec.ts` except `sqlite.spec.ts` opens
with `if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE)`; every fixture is
memoized per process and its `stop()` resets the memo, because *"Playwright's `workers:1` config runs
every UI spec file sequentially in the same worker process, sharing this module's state"*
(`support/mysql.ts`). `support/docker.ts` auto-resolves Colima's `DOCKER_HOST`.
`tests/ui/support/<engine>.ts` is a two-line re-export of the DB fixture.

**F39 — the demo stack is nine compose services, eight `docker exec` seed stanzas and one host-side
one.** `scripts/demo-dbs/docker-compose.yml` has postgres/mariadb/mysql/clickhouse/mongo/redis/kafka/
sqs(+s3); `seed.sh` execs into each container **except** SQLite, which runs on the host (`bun
"${SCRIPT_DIR}/sqlite/seed.ts"`) because there is no container to exec into. Host ports differ from
container ports only where two engines would collide (`mysql: 3307`, `clickhouse: 8124`).

**F40 — `ctx.setCommand()` text is persisted.** `adapter.ts:21-22`: *"The exact statement about to
run. Lands in `op_log.command` and §8.11's command column"* — `op_log` is a table in
`~/.kira-studio/kira.sqlite`, retained and rotated. Anything the adapter puts in that string is on
disk.

## 2. Shapes introduced in this plan

```ts
// src/shared/domain/tree.ts — MODIFIED. The one shared-domain change in this phase (D34).
export const nodeKindSchema = z.enum([
  /* … unchanged … */
  'exchange', // P37: a rabbitmq exchange — a definition-only leaf, foldered under its vhost
]);
// A rabbitmq vhost is NOT a new kind: it is `database` (D15), the same reuse redis's db index and
// sqlite's single `main` node already make.
```

```ts
// src/engine/adapters/rabbitmq/client.ts — NEW. There is no connection and no pool: HTTP basic
// auth over the platform's own fetch, with one frozen handle carrying everything a request needs.

export interface RabbitHandle {
  /** 'http(s)://host:port' — no path, no credentials, ever (D6, F40). */
  readonly baseUrl: string;
  /** `Basic ${base64(user:pass)}`, built once. The only place the password exists after connect. */
  readonly authorization: string;
  /** The connection's vhost scope, or null for "every vhost this user can see" (D11). */
  readonly vhostScope: string | null;
  readonly readOnly: boolean;
}

/** Resolves fields mode (host/port/database/username/password) or URI mode
 *  (`rabbitmq://user:pass@host:15672/vhost`), applies D13's sslmode, then probes
 *  `GET /api/overview` so a bad host, a wrong port, a missing plugin or a bad credential all fail
 *  at connect() with a message naming which one (D5). */
export async function connectRabbit(
  cfg: ResolvedConnectionConfig,
  ctx: OpCtx,
  log: AdapterDeps['log'],
): Promise<{ handle: RabbitHandle; info: ConnectInfo }>;
```

```ts
// src/engine/adapters/rabbitmq/query.ts — NEW. The ONE fetch call site in the adapter (D8).

export interface RequestOptions {
  method: 'GET' | 'POST';
  /** Path segments AFTER /api, each encoded here — never pre-encoded by the caller (D8, F8). */
  segments: string[];
  query?: Record<string, string>;
  body?: unknown;
  /** What lands in op_log.command. Defaults to `${method} /api/${encodedPath}` — never the body
   *  when the body carries a credential, and the base URL never carries one at all (F40). */
  command?: string;
}

/** Sends one request, honours ctx.signal (D7) under a request-timeout ceiling, parses the JSON
 *  body, and maps a non-2xx status through errors.ts with the broker's own `reason` verbatim. */
export async function request<T>(h: RabbitHandle, ctx: OpCtx, opts: RequestOptions): Promise<T>;

/** Follows F9's `page`/`page_size` pagination to the end of a list endpoint, 500 per page. */
export async function requestAll<T>(
  h: RabbitHandle, ctx: OpCtx, opts: RequestOptions,
): Promise<T[]>;

/** F8's rule as a function, so no call site can forget it: the default vhost is literally named
 *  '/' and must reach the wire as %2F. */
export function encodeSegment(value: string): string;
```

```ts
// src/engine/adapters/rabbitmq/read.ts — NEW.

/** F9's own ceiling, reused as this adapter's: the management API refuses to page a list bigger
 *  than 500, and a get of more than that would hold that many messages unacked while the batch
 *  runs (F11). A 1k/10k page-size selection clamps here and the view says so (D20). */
export const MAX_POLL_MESSAGES = 500;

/** F10/F11. `reject_requeue_true`, `encoding: 'auto'`, `truncate: MAX_CELL_BYTES + 1` (D22). */
export async function pollQueue(
  h: RabbitHandle, vhost: string, queue: string,
  req: Omit<ReadRequest, 'path'>, ctx: OpCtx,
): Promise<StreamPage>;

/** F18: `messages` from GET /api/queues/{vhost}/{name}, always `exact: false`. */
export async function countQueue(
  h: RabbitHandle, vhost: string, queue: string, ctx: OpCtx,
): Promise<{ value: number; exact: boolean }>;
```

```ts
// src/engine/adapters/rabbitmq/mutate.ts — NEW. Publish only (D25/D26).
const BODY_FIELD = '$body';            // shared with kafka/produce.ts and sqs/mutate.ts
const HEADERS_FIELD = '$headers';      // shared; JSON object -> properties.headers
const ROUTING_KEY_FIELD = '$routingKey'; // NEW — defaults to the queue's own name (F15)
const EXCHANGE_FIELD = '$exchange';      // NEW — defaults to '' (the default exchange)
const PROPERTIES_FIELD = '$properties';  // NEW — JSON object merged into `properties` (F24)

/** F15: the default exchange's empty name is spelled `amq.default` in a URL. */
export function exchangeUrlName(name: string): string;
```

```ts
// src/renderer/views/stream/StreamComposeMessage.vue — MODIFIED (D32).
const props = defineProps<{ tabId: string; kind: 'kafka' | 'sqs' | 'rabbitmq' }>();
```

## 3. Decisions

### Topic A — the protocol, the client and the wire

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The adapter speaks RabbitMQ's HTTP management API and nothing else, using the platform's own `fetch`. No production dependency is added in this phase.** | F2 makes it mandatory and F4/F5 make it free: every object the SPEC row names (exchanges, queues, bindings) exists *only* on this surface, and the runtime already has an HTTP client with an `AbortSignal`. This is P35's `node:sqlite` position (*"the app already stakes its own storage on it"*) reached from the other direction — not a builtin the app already used, but a protocol so ordinary that a library would only wrap `fetch` in a second vocabulary. F6 is why the whole surface lives in one file (D8) rather than being sprinkled. |
| D2 | **Rejected: adding `amqplib` beside the HTTP API for publishing and destructive consume.** | F1 shows the package is fine; F2 shows it cannot enumerate, so it could never be the *only* client, which makes this strictly a question of adding a **second** protocol. That second protocol costs: a second port (5672) the connection dialog would have to carry beside 15672, a second credential path, a second TLS story, a second error vocabulary, a second cancellation story, and a live connection whose lifecycle has to be reconciled with a stateless one. It buys exactly two things: a publish path RabbitMQ prefers for throughput (F14 — irrelevant for a GUI sending one hand-typed message) and a `basic.get` with `ack_requeue_false`, i.e. a **destructive** consume, which D26 refuses on its own merits. P32's §0 ground rule — *"One driver, not two… so the next reader cannot find two answers to 'how does this app talk to Kafka'"* — applies unchanged. |
| D3 | **Rejected: `rabbitmq-client` and `amqp-connection-manager`.** | F3: both are AMQP 0-9-1, so F2's ceiling is theirs too, and D2 already refused the protocol they implement. Named here so a later reader does not re-open the client question as if it were an unexplored one. |
| D4 | **`registry.ts` gains one lazy loader line, like every other kind, even though there is no driver to defer.** | `registry.ts:5-12`'s comment justifies the laziness by driver size; RabbitMQ has no driver, so the deferral saves almost nothing — but the *rule* is "one loader line per kind", and an eagerly-imported tenth adapter would be the one exception nobody remembers. The commit message records that this adapter adds ~0 to the engine's baseline RSS, which is a fact `tests/ui/memory.spec.ts` should keep true. |
| D5 | **`connect()` issues exactly one request — `GET /api/overview` — and turns its four distinguishable failures into four distinct messages.** `serverVersion` is `` `RabbitMQ ${rabbitmq_version}` ``; `details` carries `management` (the plugin version), `node`, `cluster` (`cluster_name`) and `vhost` (the scope, or `all`). | The client is stateless, so without a probe a wrong host or password would first surface on a tree expand rather than at connect — the same reason `mysql-family` and ClickHouse both probe (P36 D4). The four failures are all real and all confusable: **401** → `E_AUTH` with the broker's own reason (F16); **404 or a non-JSON body** → `E_CONNECT` naming the likely cause (*"no management API at this address — is the `rabbitmq_management` plugin enabled?"*, F17); **`ECONNREFUSED`** → `E_CONNECT`; **a timeout with the socket open** → `E_CONNECT` naming the most common mistake by far (*"no HTTP response — port 5672 is AMQP; the management API is on 15672"*, F17). Guessing between these is exactly what a user cannot do from the outside. |
| D6 | **One frozen `RabbitHandle` per connection: `baseUrl` (scheme + host + port, no path, no userinfo), a prebuilt `Authorization: Basic …` header, the vhost scope, and the read-only flag. No pool, no keep-alive tuning, no `session_id` equivalent.** | Credentials never enter a URL, because F40 puts `ctx.setCommand()` text in `op_log.command` on disk and a base URL is the natural thing to log; an `Authorization` header cannot leak into that string by accident. No pool because `fetch`'s own agent already keeps connections alive and every request here is small and independent — this is D5's ClickHouse reasoning (*"deleting a whole class of state is the right answer"*) applied to an adapter that never had the state to begin with. |
| D7 | **`caps.cancel = true`, delivered by passing `ctx.signal` to `fetch`; `Adapter.cancel()` stays a permanent no-op returning `false`.** One `notes`-level fact is recorded in the code and in §5.1: aborting a poll mid-flight does **not** un-deliver messages the broker has already handed the management plugin — they are requeued by the endpoint's own `finally`-equivalent regardless. | This is `sqsCaps`/`s3Caps`'s exact standing (`sqs/caps.ts:33` — *"the SDK's own abortSignal request option is fully effective"*, `sqs/index.ts`'s no-op `cancel()`), and RabbitMQ's requests are the same shape: short, bounded, independent. ClickHouse needed `KILL QUERY` because its server keeps executing after the socket dies (P36 F8) — RabbitMQ's management plugin has no long-running query to keep executing, so an abort really is the end of the work. §5.1's *"the capability is absent … rather than lying"* is satisfied: the stop button really stops the operation. The caveat is stated rather than hidden, because a user who cancels a poll should not believe the queue is untouched. |
| D8 | **Every HTTP call goes through `query.ts`'s `request()`/`requestAll()`; every path segment goes through `encodeSegment()` (`encodeURIComponent`); no caller ever hand-builds a URL.** `requestAll()` follows F9's `page`/`page_size=500` pagination to the end. | F8 is a rule that is wrong exactly once and then wrong everywhere: the default vhost is *named* `/`, so a single un-encoded segment turns `/api/queues//` into a different endpoint that 404s (or worse, matches the all-vhosts one). Queue and exchange names routinely contain `/`, spaces and unicode for the same reason. One function is also what makes D7's signal wiring, D6's header, F16's error envelope and F40's command text impossible to forget — this is Adapter rule 7's spirit (*"Every identifier they emit came out of a catalog query in the same op"*) for a REST engine. `requestAll` exists because F9's own reference says these endpoints *"can produce very large JSON responses and waste a lot of bandwidth"* when asked unpaginated. |
| D9 | **Two timeout constants: `CONNECT_TIMEOUT_MS = 10_000` for D5's probe and `REQUEST_TIMEOUT_MS = 30_000` for everything else, applied as `AbortSignal.any([ctx.signal, AbortSignal.timeout(ms)])`.** A timeout is `E_TIMEOUT`; a user abort is `E_CANCELLED`; the two are distinguished by `ctx.signal.aborted`. | `fetch` has no timeout of its own, so without this a poll against an unreachable-but-not-refusing host would hang until the OS gave up — the exact *"not a hang"* property `tests/db/*.spec.ts` asserts for every other engine. `AbortSignal.any` is available in both runtimes (F5). The two codes must not collapse into one: the UI shows a cancelled op differently from a failed one (`views/stream/state.ts:122-125`). |

### Topic B — the connection shape

| # | Decision | Rationale |
|---|----------|-----------|
| D10 | **`rabbitmq` is an ordinary network kind: host, port, database, username, password, fields *and* URI mode. It joins neither `AWS_STYLE_KINDS` nor `FILE_KINDS`, and `connection.ts`'s `superRefine` needs no new arm. `DEFAULT_PORT.rabbitmq = 15672`.** | F34: the existing validation already demands host+port for a kind in neither set, which is exactly right here. 15672 rather than 5672 because 15672 is the only port this adapter can speak to (F17, D1) — prefilling the AMQP port would prefill a guaranteed failure, and D5's fourth error message exists precisely because users will type it anyway. |
| D11 | **`database` holds the **vhost**, and it is a *scope*, not a requirement.** Empty → the tree lists every vhost `GET /api/vhosts` returns. Set → the tree shows exactly that one vhost node, and every request is scoped to it. Either way the tree's shape is identical, so paths, tabs and caches never branch on it. | This is S3's `options.bucket` precedent (§6: *"scopes the whole tree to one bucket… for IAM credentials that can only ever see that one bucket"*) with the key promoted to the column it belongs in, because unlike an S3 bucket a vhost genuinely *is* the database-equivalent (F21) and `database` is the column every other engine puts that in. RabbitMQ permissions are per-vhost, so a user who can only see one is the common case, not the exotic one. Keeping the node in the tree even when scoped is what stops `read()` from needing two path shapes. |
| D12 | **URI mode is `rabbitmq://user:pass@host:15672/vhost`, with the default vhost written `%2F`. An `amqp://`/`amqps://` URI is refused at connect with a message naming the reason. `uri.ts` needs no change and `canRoundTripToFields` stays as it is.** | F35: `rabbitmq://` falls out of the existing scheme rule for free, and *Copy URI* runs for every kind (`project/menus.ts`), so the spelling has to be right whether or not the dialog offers URI mode. `amqp://` is the URI users actually have in their clipboards, which is exactly why silently accepting it would be a trap: its host is usually right and its **port is always wrong** (5672), so the adapter would either fail confusingly or "helpfully" rewrite a port the user typed — the silent guessing this repo forbids. Refusing it with *"this connection speaks the management API on 15672, not AMQP on 5672 — use `rabbitmq://host:15672/vhost`"* teaches the difference once. The double-slash case (`rabbitmq://host:15672/%2F`) is the reason D8's encoder is a function and not a call-site convention. |
| D13 | **`options.sslmode` with exactly two meaningful values: absent/`disable` → `http://`, `require`/`prefer`/`verify-full` → `https://` with the system trust store. Anything else logs a warning and is ignored, mirroring `kafka/client.ts:59-67` and P36 D12 exactly. `options` carries nothing else.** | One vocabulary across every server-backed engine in the app, and the same "warn, don't guess" handling. Custom CAs, client certificates and `rejectUnauthorized: false` are out of scope (§6): `fetch`'s TLS configuration is process-global in Node, so a per-connection trust override would be a cross-connection change smuggled in behind one connection's options — a much larger decision than this phase. A path-prefixed management endpoint behind a reverse proxy is likewise deferred (§6), named rather than half-supported. |

### Topic C — the page kind and the tree (the plan's central question)

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **No new page kind. A RabbitMQ queue opens as an existing `stream` tab, and the five `StreamPage` columns map as: `keys` = `routing_key`; `headers` = `properties.headers` as JSON; `attrs` = the delivery facts and the remaining properties as JSON, under the management API's **own** key names; `timestamps` = `properties.timestamp` (epoch **seconds**) rendered ISO-8601, else null; `bodies` = `payload`. `visibilityTimeoutSeconds` is null.** | F26 is the seam and F11 is the fit: every field the endpoint returns lands in a column that already means that. `routing_key` is the honest analogue of a Kafka key — it is the value routing was decided by, and it is what a user scans a queue for. `attrs` is explicitly *"the one column whose meaning differs per engine"*, which is where `exchange`, `redelivered`, `payload_bytes`, `payload_encoding`, `message_count` and the non-headers properties belong. Keys stay in the broker's own spelling (`payload_bytes`, not `payloadBytes`) so what the user reads in the cell matches what they read in RabbitMQ's documentation — a translation layer here would be a second vocabulary to get wrong. `visibilityTimeoutSeconds` stays null because a "visibility N s" badge would be a claim about a mechanism RabbitMQ does not have. **A new page kind was considered and rejected**: it would mean a new `Page` variant, a new `views/rabbitmq/` folder, a second copy of the search toolbar/filter toggle (P31 D16-D21), a second cell-editor dock (P26), a second compose panel and a second set of UI specs — all to render the same five columns the stream view already renders. §11's own rule is that *"a new page kind is one new folder here plus one Page variant in shared/protocol"*; the cost is real, and nothing about RabbitMQ's **message** shape justifies paying it. What genuinely does not fit — exchanges, bindings, policies, arguments — is not message data at all, and D17 puts it where P23 already put Kafka's equivalent. |
| D15 | **Tree: connection → one node per vhost (`NodeKind` **`database`**, with a per-connection-kind label override to "Virtual host"/"Virtual hosts") → queues ungrouped, exchanges foldered under **Exchanges** via P19/P23's existing `GROUPED_KINDS`.** A queue reuses the existing `queue` kind; an exchange is a new kind (D34). | F21: a vhost is a named container that scopes every object's identity and every permission — structurally the same role `database` plays for SQL, `db index` for Redis (P9) and `main` for SQLite (P35 D10). Reusing it is not a fudge, it is three concrete wins: P28's sticky ancestor band already pins connection/database/schema rows, so a vhost header pins for free; `containerMenu` already covers it; and `stickyBand.ts`, `filterTree.ts` and the checkbox filter need nothing. F30's override table is why the label can still read "Virtual host" everywhere a kind is named. Queues ungrouped with exchanges foldered is P19's rule applied literally — the primary kind first, the auxiliary kind in a folder — the same call P23 made for Kafka after user feedback (topics ungrouped, consumer groups foldered). Queues are what a user browses; exchanges are what a user inspects. |
| D16 | **The nameless default exchange is hidden from the tree. Every other `amq.*` built-in exchange is shown.** | F15: the default exchange's name is the **empty string**. That name cannot survive this app's own plumbing honestly — `encodePath` would produce a segment `exchange:` with no name, the tab title would be blank, the tree row would be blank, and the management URL needs the invented spelling `amq.default` rather than the name itself. It also has nothing to show: no bindings (nothing may be bound to it), no arguments, no policy — its definition tab would be four lines of `durable: true`. Meanwhile it is not *hidden* from the user in any real sense: D25 publishes through it, and the compose panel names it. The other `amq.*` exchanges (`amq.direct`, `amq.fanout`, `amq.topic`, `amq.headers`, `amq.match`, `amq.rabbitmq.trace`) are ordinary named exchanges users bind to on purpose, so they stay — and P28's checkbox filter can hide them per connection if a user disagrees. Raised as open question 2. |
| D17 | **Bindings are not a node kind and never appear in the tree. They appear in the definition view, on both ends: a queue shows the bindings *into* it, an exchange shows the bindings *from* and *to* it.** Policies likewise: no tree node, one row in the object's own properties section. | F21: a binding has no name and no ID — the management API says so outright and synthesises a key from the binding's own properties. A tree needs stable, nameable, openable nodes; a binding is none of the three, and a folder of `properties_key` hashes would be unreadable. This is P23's decision restated: a Kafka topic's partitions *"moved into the definition view"* because they were facts about an object rather than objects to open, and P23's generic `sections` list (F26's sibling, `definition.ts:36-51`) was built for exactly this. Bindings appear on both ends because an exchange→exchange binding is invisible from one side, and it is the topology mistake users most often go looking for. |
| D18 | **Listing requests are trimmed and paged, not naive.** Queues: `GET /api/queues/{vhost}?page=N&page_size=500&disable_stats=true&enable_queue_totals=true`. Exchanges: `GET /api/exchanges/{vhost}?page=N&page_size=500&disable_stats=true`. Vhosts: `GET /api/vhosts` (not paginated by the API). Tree detail text: a queue shows `<n> messages · <type>`; an exchange shows its type (`direct`/`fanout`/`topic`/`headers`). | F9 is not a micro-optimisation — the reference itself warns that the untrimmed queues endpoint returns *"over 50 fields per queue"* and *"can produce very large JSON responses and waste a lot of bandwidth and CPU resources"*, and this tree level is fetched on every expand and every Refresh. `enable_queue_totals` is what keeps the message count in the trimmed response, which is what makes the detail text possible without a second request per queue (the mistake §7's L1 cache exists to make unnecessary, and the P13 tripwire in §5 asserts against). |
| D19 | **`caps.describe = false`; `describe()` throws `E_UNSUPPORTED`, exactly as Kafka's and SQS's do.** | `caps.ts:33-36`'s own comment: *"false for kafka/sqs/redis/s3 — a stream or a key has no column/PK/FK metadata to describe, so `definition()` alone is the whole story for them."* A queue has no columns; P23 already made the definition view render without a `describe()` load. |

### Topic D — reading, counting and writing

| # | Decision | Rationale |
|---|----------|-----------|
| D20 | **`caps.pagination = 'batch'`, and `read()` returns `strategy: 'batch'`, `hasMore: false`, `nextToken: null`, `prevToken: null` on every page. A cursor of any mode is ignored, not rejected. Every poll is `POST /api/queues/{vhost}/{name}/get` with `count = min(pageSize, MAX_POLL_MESSAGES)` = at most **500**.** | F11 makes this SQS's situation exactly (`sqs/read.ts:49-60`: *"SQS has no addressable position at all — every poll is an independent, non-resumable snapshot"*): a `basic.get` batch has no offset, no token and no resumable position, and the next poll re-reads from the head. `'batch'` is therefore already the right member of `PaginationStrategy` and gets D32's poll-on-demand behaviour for free (F27). A cursor is **ignored rather than errored** to match SQS byte for byte — a *"cursor is unsupported"* rejection would make Next/Previous fail loudly in a view that never shows them. 500 is F9's own documented ceiling for this API's list endpoints, and F11 is why it matters here too: every message in the batch is held unacked until the whole batch finishes, so a 10 000-message get would make 10 000 messages briefly invisible to real consumers. The clamp is not silent — D32's warning strip states it. |
| D21 | **`ackmode: 'reject_requeue_true'`, always. No ackmode is configurable, and the destructive ones are never sent.** `encoding: 'auto'`. | F10's four modes split two ways, and only the requeueing half is compatible with a *browser*. `reject_requeue_true` over `ack_requeue_true` because `basic.reject` is the single-message verb (F11's source shows `ack_requeue_true` becomes a `basic.nack` with `multiple = false` — the same effect, one indirection further from the name). Making it configurable would put a control in the UI whose wrong setting silently destroys a user's messages; §1's *"read paths complete"* does not mean "read paths with a foot-gun". `encoding: 'auto'` because it is the only setting that returns readable text for text and lossless base64 for bytes (F10) — and D22's `payload_encoding` in `attrs` is what tells the user which they got. |
| D22 | **`truncate: MAX_CELL_BYTES + 1` is sent on every poll, and the true size is reported as `attrs.payload_bytes`.** | F29 is the trap: `appendValue` marks a row truncated only when *it* truncates, so asking the broker for exactly `MAX_CELL_BYTES` would deliver a value at the budget, unmarked, and the UI would show a silently-clipped body as a complete one. Asking for one byte more means an oversize payload arrives *over* the budget, the page builder truncates it at a UTF-8 boundary and sets the row's `truncated` bit — so the cell editor's existing "a truncated value can be read and copied, but never staged as a write" rule (§8.6) engages with no protocol change and no new flag. One byte per oversize message, one comment line, zero new machinery. `payload_bytes` is trustworthy for this because F11's source computes it **before** truncation. |
| D23 | **`caps.exactCount = false`. `count()` is `GET /api/queues/{vhost}/{name}` reporting `messages`, with `exact: false`.** | F18: the number describes a live queue that any consumer can change between the count and the read, and on the list endpoints it comes through the management plugin's statistics database. This is SQS's `ApproximateNumberOfMessages` situation, and SQS's answer (`sqs/caps.ts:21`) is the right one here. Claiming `exact: true` for a number that is a snapshot of a moving queue would be the same class of lie as claiming a cancel that does not cancel. |
| D24 | **A `stream`-type queue's poll surfaces the broker's own sentence as `E_UNSUPPORTED`**, not as a generic 500. | F13 is a permanent engine fact with a legible message already attached (*"basic.get not supported by stream queues"*), and `E_UNSUPPORTED` is the code whose meaning is exactly that. Adapter rule 4 keeps the broker's wording verbatim. A user who opens a stream queue and gets *"Internal Server Error"* learns nothing; one who gets that sentence learns the whole story. Scenario 14 is the guard. |
| D25 | **`canInsert: true`. A publish is `POST /api/exchanges/{vhost}/{exchangeUrlName}/publish` with `{properties, routing_key, payload, payload_encoding: 'string'}`; from a queue tab it defaults to the default exchange (`amq.default`) with `routing_key` = the queue's own name. `$exchange`, `$routingKey` and `$properties` join the existing `$body`/`$headers` sentinels. A response of `{"routed": false}` is `E_QUERY`, not success.** `preview()` renders the method, the path and the exact body. | F15 is the mechanism, and it is the management UI's own: *"Message will be published to the default exchange with routing key **&lt;queue&gt;**, routing it to this queue."* Following the broker's own client here means the app cannot invent a spelling the server does not recognise. The three new sentinels ride P33's established technique rather than widening `MutationPlan`. **`routed: false` as an error is the load-bearing half**: a publish the broker accepted and routed nowhere has *silently discarded the user's message* (or dead-lettered it to an alternate exchange), and reporting "sent" for that is precisely the "nothing silently dropped" rule violated at the worst moment. The message names the two real causes — the routing key matches no binding, or the exchange has none. |
| D26 | **`canUpdate: false`, `canDelete: false`, `writable: true`. `mutate()` accepts only `insert`; an `update` or `delete` op is `E_UNSUPPORTED` with a message naming the reason. `preview()` refuses the same ops the same way.** | F22 and F25 together: a RabbitMQ message has no broker-assigned identity to address, and the protocol has no per-message delete or update at all. This is `kafka/caps.ts:24-31`'s exact shape — *"these two stay `false` permanently, not 'not yet implemented'"* — and it is one flag narrower than SQS, whose receipt handle genuinely addresses one delivered message (`sqs/caps.ts:24-30`). Note what is being refused: not "delete is hard", but "there is nothing to delete *to*". The only removals RabbitMQ offers are consuming (which D21 refuses to do behind a browse) and purging (which is queue-wide, §6). |
| D27 | **A read-only connection may still poll; only `mutate()` is refused, before any request leaves the process.** The warning strip (D32) states the requeue effect for every connection, read-only or not. | Consistency with SQS, whose poll is likewise a read despite making messages temporarily invisible, and with §8.13's definition of the read-only guard as *"disables `+ row`, `− row`, cell editing, document edit/delete and console execution of anything but a read"*. Refusing the guard before the request (rather than letting the broker refuse it) is what makes scenario 22's request-counter assertion possible, and mirrors `sqs/mutate.ts:89`'s own first line. |
| D28 | **The remaining caps, each with its reason: `sql: false` (there is no ad-hoc command language for the management API worth a console — P10 D13's standing call for Kafka/SQS), `definition: true` (D29/D30), `projection: false` and `serverFilter: false` (the get endpoint takes a count and nothing else — no predicate, no field selection), `foreignKeys: false`, `transactions: false`, `fileTransfer: false`, `tabular`/`documents`/`keyValue` false with `stream: true` and `defaultPageKind: 'stream'`.** | Every one is a fact, not a deferral, and `caps.ts` is a contract (§5). `transactions: false` is worth stating out loud even though nothing reads it (P36 F36's observation): AMQP transactions exist as a protocol feature and the management API exposes none of them, so the honest value is false and now is when the reason is in front of us. |

### Topic E — the definition view

| # | Decision | Rationale |
|---|----------|-----------|
| D29 | **A queue's definition: `sections` = **Queue** (type, durable, auto-delete, exclusive, state, node, leader, consumers, messages ready/unacked/total, message bytes, policy, effective policy definition), **Arguments** (every `x-*` argument, one row each; an explicit "none set" row when empty), **Bindings** (source exchange, routing key, arguments — `GET /api/queues/{vhost}/{name}/bindings`), **Consumers** (tag, channel, ack mode, prefetch — from the queue object's own `consumer_details`). `statements` is the queue object's JSON verbatim, `language: 'json'`, `origin: 'server'`. Two requests total.** | This is `sqs/definition.ts:25-63`'s shape one level richer, and P23's `sections` mechanism used for exactly what its own doc comment describes (*"a named block of name/value facts about an object that is neither SQL text nor `ObjectMeta`"*). `consumer_details` and `effective_policy_definition` (F23) arrive on the single-queue GET, so Consumers and the policy rows cost **no extra request** — bindings are the only second call. The Source pane is the object's own JSON rather than a composed document, for the same reason `sqs/definition.ts` does it: it is what the server said, and Adapter rule 4's spirit is that the app does not paraphrase the server. |
| D30 | **An exchange's definition: `sections` = **Exchange** (type, durable, auto-delete, internal, policy), **Arguments** (`x-*`, e.g. `alternate-exchange`), **Bindings from this exchange** (destination, destination type, routing key, arguments) and **Bindings to this exchange** (source, routing key) — `…/bindings/source` and `…/bindings/destination`. `statements` is the exchange object's JSON verbatim. Three requests.** | D17's "both ends" rule made concrete. *Bindings to this exchange* is the section that earns its keep: an exchange→exchange binding is invisible from the exchange a user is looking at unless someone asks for it, and it is exactly the topology a user goes to a GUI to understand. `internal` is included because an internal exchange silently refuses direct publishes, which is a confusing failure to debug without seeing the flag. |
| D31 | **`notes` carries three sentences, each stating a fact the view would otherwise imply wrongly:** (1) message counts are a snapshot, not a transactional count (F18); (2) reading messages through the management API requeues them and marks them redelivered (F12); (3) a binding has no name — the key shown is one the management API synthesises from the binding's own properties (F21). Nothing is invented for the UI to display beyond these. | P23's degradation precedent (`kafka/definition.ts` *"degrade to a `notes` line rather than failing the tab"*) and P36 D22's use of `notes` for structural caveats. Each sentence exists because a user could otherwise draw a false conclusion from something the tab *does* show. |

### Topic F — the renderer seam

| # | Decision | Rationale |
|---|----------|-----------|
| D32 | **The stream view becomes three-kind aware in exactly four places, and gains no new mechanism.** (a) The `isBatch` warning strip's text switches per connection kind: SQS keeps *"Each poll **consumes** messages…"*; RabbitMQ reads *"Each poll fetches up to 500 messages through the management API and immediately requeues them — nothing is removed, but they are marked redelivered and their position in the queue can change."* (b) `isRabbit` joins `isKafka`/`isSqs`. (c) The compose panel accepts `kind: 'rabbitmq'` and shows Body, Routing key (prefilled with the queue name), Exchange (prefilled `(AMQP default)`), Headers (JSON) and a **Persistent** checkbox (`delivery_mode: 2`). (d) The Delete-message button stays SQS-only, gated on `caps.canDelete` exactly as it is today. | F27/F28: every one of these is a branch the view already has, in the shape it already has it. The strip text is the one thing that **must** change rather than being reused — the current sentence is a true statement about SQS and a false one about RabbitMQ, and a false warning is worse than none. The Persistent checkbox is the one property worth a control (it is the difference between a message surviving a broker restart and not) and mirrors the management UI's own queue-publish form; arbitrary property editing goes through `$properties` at the adapter level but gets no UI in this phase (§6). Delete needs no work at all: it is already `v-if="isSqs && canDelete"`, and `canDelete` is false here. |
| D33 | **The per-kind tables gain one row each, and `EngineIcon.vue` + `parts/_icons.html` gain a matching mark together.** `KIND_LABEL.rabbitmq = 'RabbitMQ'`, `KIND_ACCENT.rabbitmq = 'indigo'`, `SUPPORTED_KINDS` gains it; `icons.ts`'s `KIND_ICON.exchange = 'git-merge'`; `grouping.ts` gains `exchange`'s labels, the `database` → "Virtual host" override for `rabbitmq`, and `{ kind: 'exchange' }` in `GROUPED_KINDS`; `menus.ts` gains an `exchange` case (Open definition, Copy name, Copy qualified name — `consumerGroupMenu`'s exact shape). | F36: `indigo` and `grey` are the only free accents, and `grey` reads as the "no colour" swatch beside the palette's own `none`; RabbitMQ's own orange belongs to ClickHouse since P36, and a cool hue is the better outcome anyway because RabbitMQ sits beside Kafka (amber) and SQS (magenta) in a list of stream engines. The mark is drawn, not vendored, per `EngineIcon.vue`'s own header — a rabbit silhouette redrawn as `currentColor` paths, the same way MySQL's dolphin and SQLite's feather were. Both files change in the same commit because an unknown kind renders an **empty `<svg>` with no error** in three places at once (F36) and the component asserts 1:1 correspondence with `_icons.html`. `git-merge` for an exchange because routing one input to many bound destinations is what the glyph already means in this icon set. |
| D34 | **`nodeKindSchema` gains `'exchange'` — the one shared-domain change in this phase, named here rather than discovered in the diff.** A vhost is **not** a new kind (D15). | P36 D28 set the precedent for stating a shared change plainly instead of letting a *"a new engine is one folder"* claim quietly break (§11). This one is genuinely additive: `nodeKindSchema` is a Zod enum, `decodePath` rejects unknown kinds, and every consumer of `NodeKind` that is a total `Record` (F30's `KIND_LABELS`, F31's `KIND_ICON`) becomes a **type error** until it is updated — which is the failure mode this phase wants. Not adding it and reusing, say, `topic` for an exchange would produce a tree whose paths lie about what they point at. |
| D35 | **`views/shared/sqlIdent.ts`, `editor/languages.ts`, `project/typeGlossary.ts`, `views/console/*` and every grid file are untouched.** | RabbitMQ has no SQL dialect, no console (`caps.sql` false), no columns and no data types, so every seam P34/P35/P36 had to widen is inert here. Stated because a reader arriving from three consecutive SQL-adapter phases will expect those files in the diff, and their absence is a fact about this engine rather than an omission. |

### Topic G — tests, fixtures and demo data

| # | Decision | Rationale |
|---|----------|-----------|
| D36 | **`tests/db/support/rabbitmq.ts` uses `@testcontainers/rabbitmq@12.1.0`, pins `rabbitmq:4.3.5-management-alpine`, and **overrides the preset's wait strategy** with `Wait.forHttp('/api/overview', 15672).withBasicCredentials('guest','guest').forStatusCode(200)`, with a 120 s startup timeout.** Same memoized one-container-per-process shape, same `stop()`-resets-the-memo discipline, same `resolveDockerHost()` import (F38). | F19: the preset carries the port mapping, the credential env vars and the `StartedRabbitMQContainer` wrapper, so hand-rolling a `GenericContainer` would only re-derive them. But its own wait strategy watches for the AMQP-era *"Server startup complete"* log line and it exposes no HTTP helper — and this adapter needs the **management listener**, which is a plugin that finishes starting on its own schedule. Waiting on the endpoint the tests actually call is the difference between a deterministic suite and a first-scenario flake. `-management` is mandatory (F20); `-alpine` for pull size. |
| D37 | **The fixture seeds over the management HTTP API with `fetch`, from the test process — no client, no `docker exec`, no CLI.** | P32 D26 moved the Kafka seed into the container specifically to keep a JS Kafka client out of the Playwright/Node process (its whole reason was the native addon's ABI). There is no client here to keep out: `fetch` is a global in both runtimes (F5), so seeding over HTTP costs nothing, needs no image-specific tooling (the alpine image ships neither `curl` nor `python3` reliably, and RabbitMQ 4's `rabbitmqadmin` is a separate download), and exercises the same surface the adapter does — a seed that fails tells you the API is not up yet, which is information. |
| D38 | **`tests/db/fixtures/0011_rabbitmq_seed.ts` builds a topology every scenario earns:** vhosts `/` and `kira`; queues `orders` (classic, 6 messages with headers, timestamp and correlation-id properties), `empty-queue`, `big-queue` (2 000 messages, for the 500 clamp), `binary-queue` (one non-UTF-8 payload, one 100 KB payload), `quorum-queue` (`x-queue-type: quorum`), `stream-queue` (`x-queue-type: stream`, for D24), `dlx-queue` (`x-message-ttl`, `x-dead-letter-exchange`) and `weird/name ✓` (percent-encoding); exchanges `orders.direct`, `events.fanout`, `events.topic`, `props.headers`, `alt.exchange`; bindings including `events.fanout → events.topic` (exchange-to-exchange) and `orders.direct → orders`; and one policy applied to `orders`. | `0002_mariadb_seed.sql`'s parity principle, applied to a broker: the fixture exists so the scenarios can assert something real, and every object above is named in exactly one scenario in §5. `stream-queue` and `weird/name ✓` are the two that would never appear in a fixture written by copying `0006_sqs_seed.ts`, and they are the two that catch the failures a copy would introduce (D24's error path and D8's encoder). |
| D39 | **`tests/ui/rabbitmq.spec.ts` is Docker-gated like every engine's UI spec except SQLite's**, a deliberate subset of `tests/ui/sqs.spec.ts` whose three load-bearing assertions are: the queue tab **never auto-loads** and shows the RabbitMQ-specific strip text (not SQS's), Poll renders the routing key in the `key` column, and the **Delete-message button is absent** while Add is present. | P35 D35's unconditional spec was possible only because a temp file needs no container; RabbitMQ needs one. The three assertions are chosen because each is a seam that fails *silently*: a missing `isRabbit` branch would show SQS's "consumes" warning against a broker that consumes nothing, a wrong column mapping would show blank keys that look like "no key set", and an un-gated Delete would offer an operation the adapter refuses. |
| D40 | **The demo stack gains a tenth compose service (`rabbitmq:4.3.5-management-alpine`, host port **15672**, no AMQP port published) and a **host-side** seed stanza (`bash scripts/demo-dbs/rabbitmq/seed.sh`, `curl` against `localhost:15672`), not a `docker exec` one.** | F39: 15672 collides with nothing in the stack, so the demo convention (differ only where engines collide, `mysql: 3307`, `clickhouse: 8124`) says leave it. 5672 is deliberately **not** published: the app cannot speak it (D1), and publishing it would suggest otherwise. The seed runs on the host for D37's reason plus one more — the SQLite stanza already established that a host-side seed is normal in this script when the container has nothing useful to exec into. |

### Topic H — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D41 | **Docs the implementing session edits:** SPEC **§1** (RabbitMQ joins the in-scope engine list; the write-path sentence gains RabbitMQ among the immediate-apply engines, insert-only), **§5** (a sentence naming RabbitMQ as the third engine with permanently-false update/delete flags, and the first whose reason is "a message has no identity at all"), **§5.1** (a RabbitMQ row: *vhost → queues (ungrouped), exchanges (folder); bindings in the definition view* / `stream` / *"one poll per press — `basic.get` batches of ≤500 through the management API, no addressable position"* / *"no (`messages` is a snapshot)"* / *"`AbortSignal` on the HTTP request"*, plus the read-policy paragraph extended from "SQS read policy" to cover RabbitMQ's requeue-and-redeliver effect), **§8.9** (the stream view's third engine: routing key/properties/exchange columns, publish through the default exchange, no per-message delete), **§8.10** (an **Exchange** row in the right-click table), **§8.11** (the queue/exchange definition sections), **§11** (`adapters/rabbitmq/` in the tree, plus `'exchange'` noted in `shared/domain/tree.ts`), `shared/caps.ts`'s per-kind table, `README.md`'s engine table plus a footnote, and `AGENTS.md` (a "RabbitMQ adapter (HTTP management API, P37)" section: no dependency at all; the image must be a `-management` tag; the `%2F` vhost rule; the Docker gate; polling requeues). The **§10 phasing row is updated only once the phase is implemented.** | Standing practice (P34 D33, P35 D37, P36 D39). `AGENTS.md` earns a section for the same reason ClickHouse's did, inverted twice over: a future session will reasonably assume a message broker needs a driver and a build step, and the file should say it needs neither — and will reasonably reach for a plain `rabbitmq:4` image, which has no management plugin and therefore no API at all. |
| D42 | **No change to `scheduler/`, `cache/`, `adapters/live.ts`, `adapters/sql-text.ts`, `main/`, any `Page` variant, any Zod page schema, or any other adapter.** The two exceptions are named: D34's additive `NodeKind`, and D32's four view branches. | §11's claim that a new engine is one folder. RabbitMQ returns the same `StreamPage` Kafka and SQS already return, on the same `'batch'` strategy SQS already uses, so the L2 cache key, the MessagePort transfer and the op-log path are all untouched. P36 could not make the stronger claim and said so; this phase can make it for everything except one enum member, and says which. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green. Steps 1–2 are the engine, 3–5 the app surface, 6–8 the tests, 9–10 demo data
and docs. Steps 6–8 need Docker and cannot be executed in Claude Code's Linux web container
(`AGENTS.md`); everything else can. **There is no dependency commit** — P36's step 2 has no
counterpart here, because D1 adds nothing to `dependencies` (only step 6 touches `package.json`, for
one devDependency).

1. **`feat(shared): the rabbitmq connection kind and the exchange node kind`** —
   `shared/domain/connection.ts` (the `connectionKindSchema` entry and
   `DEFAULT_PORT.rabbitmq = 15672`; deliberately no `AWS_STYLE_KINDS`/`FILE_KINDS` membership and no
   new `superRefine` arm — D10), `shared/domain/tree.ts` (`nodeKindSchema` gains `'exchange'` with
   its one-line comment — D34), and `shared/caps.ts`'s per-kind doc-table row. `typecheck` will now
   fail on `grouping.ts`'s `KIND_LABELS` and `icons.ts`'s `KIND_ICON` — **both are fixed in this same
   commit** with their labels and icon (the totality is the point of D34, and a commit that leaves
   the tree red is not a commit). No adapter yet: `registry.ts` has no loader, so a RabbitMQ
   connection is refused by `createAdapter`'s existing `E_UNSUPPORTED` (`registry.ts:26-31`) — the
   same intermediate state every kind has passed through.
2. **`feat(engine): the RabbitMQ adapter`** — the whole of `adapters/rabbitmq/` (nine files:
   `index.ts`, `caps.ts`, `client.ts`, `query.ts`, `catalog.ts`, `read.ts`, `mutate.ts`,
   `definition.ts`, `errors.ts`) plus the one `registry.ts` loader line (D4–D9, D14–D31). This is the
   phase's large commit; the `Adapter` interface admits no partial implementation, and a half-adapter
   with `E_UNSUPPORTED` stubs is exactly what `AGENTS.md`'s "scope left out is left out entirely"
   forbids.
3. **`feat(renderer): RabbitMQ's tree — virtual hosts, exchanges and their menu`** —
   `project/grouping.ts` (the `database` → "Virtual host" per-connection-kind override, `exchange`'s
   labels, `{ kind: 'exchange' }` in `GROUPED_KINDS`), `project/menus.ts` (the `exchange` case,
   `consumerGroupMenu`'s shape) (D15, D17, D33). `ProjectTree.vue` is deliberately **not** touched:
   an exchange is a definition-only leaf, so double-click is a no-op and Open definition lives in the
   context menu — `consumerGroup`'s standing behaviour (F32).
4. **`feat(renderer): the RabbitMQ tile, accent and mark`** — `project/ConnectionDialog.vue`
   (`KIND_LABEL`, `KIND_ACCENT: 'indigo'`, `SUPPORTED_KINDS`), `theme/EngineIcon.vue` and
   `docs/v1/design/kira-design-system/parts/_icons.html` (the `i-rabbitmq` symbol), together (D33).
5. **`feat(renderer): the stream view speaks RabbitMQ`** — `views/stream/StreamView.vue` (the
   per-kind strip text, `isRabbit`, the compose panel's third kind),
   `views/stream/StreamComposeMessage.vue` (the `'rabbitmq'` shape: routing key, exchange, persistent),
   `views/stream/streamMutations.ts` (`publishRabbitMessage`) (D32). `xvfb-run -a bun run test:ui`'s
   four non-Docker specs plus an unchanged `tests/ui/{kafka,sqs}.spec.ts` are the guard that the
   other two engines' branches moved by nothing.
6. **`test(db): the RabbitMQ container fixture and seed`** — `tests/db/support/rabbitmq.ts`,
   `tests/db/fixtures/0011_rabbitmq_seed.ts`, and the `@testcontainers/rabbitmq` devDependency
   (D36–D38).
7. **`test(db): the RabbitMQ adapter scenarios`** — `tests/db/rabbitmq.spec.ts`, §5's list.
8. **`test(ui): RabbitMQ through the real UI`** — `tests/ui/support/rabbitmq.ts` (the two-line
   re-export) and `tests/ui/rabbitmq.spec.ts` (D39).
9. **`chore(demo): a RabbitMQ demo service`** — `scripts/demo-dbs/rabbitmq/seed.sh`, the compose
   service, the `seed.sh` stanza, and the `demo-dbs/README.md` row (D40).
10. **`docs: SPEC §1/§5/§5.1/§8.9/§8.11/§11, the caps table, the README and AGENTS for RabbitMQ`** —
    D41's edits (not the phasing row), and this plan's own commit if it is not already landed.

## 5. Tests

### Existing specs and what must happen to them

| Spec | Why | Change |
|---|---|---|
| `tests/ui/sqs.spec.ts` | Step 5 changes the `isBatch` warning strip from one fixed sentence into a per-kind one. | **No change.** It is the regression guard: SQS's existing assertion on the *"Each poll consumes…"* strip must still pass byte for byte. A failure here means the per-kind switch defaulted the wrong way. |
| `tests/electron-db/kafka.spec.ts`, `tests/ui/kafka.spec.ts` | Step 5 touches the shared stream view and the compose panel's prop union. | **No change.** Kafka's key/body/headers compose shape and its filter row must be untouched; the prop union widening is additive. |
| `tests/db/sqs.spec.ts` | Untouched — D42 changes no shared engine module and the `StreamPage` shape is frozen. | **No change.** Re-run as the guard that `createStreamPageBuilder` really was left alone. |
| `tests/ui/tree.spec.ts` | Step 3 adds a `GROUPED_KINDS` entry and a per-connection-kind label override. | **No change.** The existing Postgres/Kafka folder assertions are the guard that P19/P23's grouping moved by nothing. |
| `tests/ui/connections.spec.ts` | Step 4 adds a tenth engine tile. | **No change.** It drives the Postgres path and runs without Docker, so it is the one that can be proven green in every environment. |
| `tests/ui/memory.spec.ts` | `registry.ts` gains a tenth lazy loader. | **No source change**, but re-run: the RSS budget must not move at all. This adapter imports no driver (D1/D4), so any movement here is a real regression. |

### `tests/db/rabbitmq.spec.ts` — the scenario list

Structured like `sqs.spec.ts` (F38's harness, a `rowAt()` decoder over the five stream columns, an
`expectSyncThrow` helper for `preview()`).

1. **connect / disconnect** — `serverVersion` matches `/^RabbitMQ 4\./`; `details` carries
   `management`, `node`, `cluster` and `vhost`; after `disconnect()` a subsequent `children()`
   rejects `E_CONNECT`.
2. **the four connect failures are four messages** — **2a.** a wrong password → `E_AUTH` carrying the
   broker's own `reason` (F16); **2b.** an unreachable port → `E_CONNECT`, not a hang past
   `CONNECT_TIMEOUT_MS`; **2c.** the container's **AMQP** port (5672) → `E_CONNECT` whose message
   names the port mistake; **2d.** an `amqp://` URI in URI mode → refused with a message naming
   `rabbitmq://` (D12). 2c and 2d are the two a user actually hits.
3. **cap honesty** — every flag in `rabbitmqCaps` asserted against §5.1's row, including
   `canDelete === false`, `exactCount === false`, `pagination === 'batch'`, `cancel === true`,
   `describe === false`, `sql === false`.
4. **tree enumeration** — the root lists both seeded vhosts; a vhost lists its queues as `queue`
   nodes and its exchanges as `exchange` nodes; the `amq.*` built-ins are **present**; the nameless
   default exchange is **absent** (D16); every node's `hasChildren` is false.
5. **vhost scoping and `%2F`** — a config with `database: 'kira'` returns exactly one vhost node and
   only that vhost's objects; a config with no `database` returns both; a queue under the default
   vhost `/` reads successfully, proving the `%2F` encoding end to end (D8/D11).
6. **names that break naive URLs** — the seeded `weird/name ✓` queue enumerates, describes,
   polls and counts; its encoded `NodePath` round-trips through `decodePath` (D8).
7. **children of a leaf** — `children()` on a queue path and on an exchange path both return `[]`,
   never throw (Adapter rule 5).
8. **describe stays unsupported** — `E_UNSUPPORTED` (D19).
9. **definition: a queue** — the four sections are present in order; **Queue** names the type and the
   applied policy; **Arguments** lists `dlx-queue`'s `x-message-ttl` and `x-dead-letter-exchange`;
   **Bindings** carries the seeded `orders.direct → orders` binding with its routing key;
   `statements[0]` parses back to an object whose `name` is the queue; `notes` has the three
   sentences (D29/D31).
10. **definition: an exchange** — **Bindings from this exchange** carries `events.fanout →
    events.topic` with `destination_type: 'exchange'`, and *Bindings to this exchange* on
    `events.topic` carries the same binding from the other side (D30).
11. **read: the column mapping** — a poll of `orders` returns 6 rows; `key` is the routing key;
    `headers` parses to the seeded headers object; `attrs` carries `exchange`, `redelivered`,
    `payload_bytes`, `payload_encoding` and `message_count` under the broker's own key names;
    `timestamp` is the ISO form of the seeded `properties.timestamp` **seconds** value; a message
    seeded without a timestamp property reports `null`, not the poll time (D14, F24).
12. **read is non-destructive** — after two consecutive polls, `count()` reports the same number it
    did before the first, and the second poll returns the same set of bodies, with `redelivered`
    true (D21, F12). *The scenario that justifies the whole read design.*
13. **read: the 500 clamp** — a `pageSize: 10_000` poll of `big-queue` returns at most 500 rows, and
    the request body observed by a `fetch` spy carries `count: 500` (D20).
14. **read: a stream queue** — `stream-queue` polls to `E_UNSUPPORTED` whose message contains
    *"basic.get not supported by stream queues"*, verbatim (D24, F13).
15. **read: an empty queue** — an empty page, `rowCount: 0`, not an error.
16. **read: a nonexistent queue** — `E_NOT_FOUND` carrying the API's `queue_not_found` reason (F16).
17. **read: binary and oversize payloads** — `binary-queue`'s non-UTF-8 message comes back with
    `attrs.payload_encoding === 'base64'` and decodes byte-for-byte to the seeded bytes; the 100 KB
    message's row reports `isTruncated(page.bodies, row) === true` while `attrs.payload_bytes`
    reports the full 100 KB (D22). *The scenario that catches anyone "simplifying" the
    `MAX_CELL_BYTES + 1` trick.*
18. **read: batch position** — every page reports `strategy: 'batch'`, `hasMore: false` and both
    tokens null; passing an `after`-mode cursor changes nothing and raises nothing (D20).
19. **count** — `orders` reports the seeded count with `exact: false`; a queue with unacked messages
    reports `messages`, not `messages_ready` (D23).
20. **cancel** — an already-aborted `ctx.signal` rejects **before** any request goes out (asserted
    with a `fetch` spy at zero calls); aborting mid-poll rejects `E_CANCELLED`, not `E_TIMEOUT`;
    `adapter.cancel(opId)` returns `false` without throwing (D7/D9).
21. **mutate: publish round-trips** — publishing `{$body, $headers, $properties: {"delivery_mode":2}}`
    to `orders` lands: a subsequent poll shows the body, the headers and `delivery_mode: 2` in
    `attrs`; `affectedRows` is 1; and `preview()`'s single string is byte-identical to the
    `POST /api/exchanges/%2F/amq.default/publish` line plus the exact body that was sent (D25).
22. **mutate: unroutable is an error** — a publish with `$exchange: 'orders.direct'` and a routing
    key matching no binding rejects `E_QUERY` naming the unrouted outcome, and the queue's count is
    unchanged (D25).
23. **mutate: the refusals** — an `update` op and a `delete` op are each `E_UNSUPPORTED` naming the
    no-identity reason; a plan mixing an insert with a delete is refused **whole** (the insert must
    not land); a read-only connection's `mutate()` is `E_UNSUPPORTED` with **zero** requests sent
    (D26/D27).
24. **the credential never reaches the command text** — a full connect → children → definition →
    read → count → mutate cycle collects every `ctx.setCommand()` string; none contains the password,
    and none contains `@` userinfo (D6, F40). *The scenario that keeps a password out of
    `op_log`.*
25. **`execute()` and `downloadObject()` stay unsupported** — both `E_UNSUPPORTED`
    (`caps.sql`/`caps.fileTransfer` false).
26. **the P13 tripwire: one request per tree level** — expanding a vhost issues exactly **two**
    GETs (queues, exchanges) regardless of how many objects it holds, and no per-object request;
    a second `read()` on the same queue issues no extra catalog call (D18).
27. **the leak guard** — a failed connect leaves the adapter with a null handle (a subsequent
    `children()` is `E_CONNECT`, not a `TypeError`), and a poll aborted mid-flight leaves the adapter
    usable: a fresh read on the same instance succeeds immediately.

### `tests/ui/rabbitmq.spec.ts` — a small, Docker-gated subset

Same structure as `tests/ui/sqs.spec.ts`, including the container timeout and the
`isDockerAvailable()` skip (D39):

1. The engine picker shows a **RabbitMQ** tile with a **non-empty** mark, and picking it shows host,
   port, user, password and database fields with the port prefilled to **15672**.
2. The connection saves and connects: green dot, and a `RabbitMQ 4.` server version in the status
   tooltip.
3. The tree lists the vhost node(s), its queues ungrouped, and an **Exchanges** folder — with no
   default-exchange row inside it (D16).
4. Opening a queue shows the **"Click Poll to fetch messages"** empty state (it never auto-loads) and
   a warning strip whose text mentions **requeue**, not "consumes" (D32) — the direct test that the
   per-kind branch exists.
5. Pressing **Poll** renders rows whose `key` column holds the routing key and whose `body` column
   holds the seeded payload.
6. **Add message** publishes (routing key prefilled with the queue name) and a second Poll shows it;
   the **Delete message** button is absent, while the same spec's SQS sibling has it (D26/D32).
7. An exchange row's context menu offers **Open definition** and no *Open data*; the definition tab's
   Structure pane shows an **Exchange** section naming the type and a **Bindings from this exchange**
   section (D30/D33).

### What is deliberately not added

No unit tests (§9's standing rule). `encodeSegment`, `exchangeUrlName` and the attrs/properties split
are pure functions, and scenarios 5, 6, 11, 17 and 21 are where their correctness is observable.

## 6. Explicitly out of scope

- **AMQP 0-9-1, in every form** (D2/D3) — including a "publish over AMQP, browse over HTTP" hybrid,
  which was considered and rejected: it doubles the connection surface for one operation whose only
  advantage (F14's throughput) is irrelevant to a GUI publishing one hand-typed message at a time.
- **Destructive consume** (`ackmode: ack_requeue_false` / `reject_requeue_false`, D21) — a browse
  that removes what it shows. If it is ever wanted, it needs its own confirmation dialog and its own
  name in the UI; it is not a setting to add to a Poll button.
- **Purge, and every other topology mutation** — `DELETE /api/queues/{vhost}/{name}/contents`, and
  every `PUT`/`DELETE` of queues, exchanges, bindings, policies, users, permissions and vhosts. §0's
  ground rule and §1's DDL-is-read-only line. Purge is the closest call and is named here rather than
  forgotten: it is a queue-level destructive action with no existing affordance in this app (every
  mutation this app performs goes through `MutationPlan`'s row ops), so it is a new UI precedent, not
  an adapter question.
- **Per-message delete and update** (D26) — structurally impossible (F22/F25), not deferred.
- **A message-property editor beyond the Persistent checkbox** (D32) — the adapter accepts
  `$properties` as a JSON object, so widening the compose panel later is a renderer-only change with
  no adapter work.
- **Consumers, connections, channels and nodes as browsable objects** — `GET /api/consumers`,
  `/api/connections`, `/api/channels`, `/api/nodes` are all real and all interesting to an operator,
  and none of them is a message store. A queue's own consumers appear in its definition (D29);
  cluster-wide operator views are a different feature from a database client's tree.
- **Shovels, federation, and the `rabbitmq_*` plugin surfaces** beyond `rabbitmq_management` itself.
- **Definitions export/import** (`GET /api/definitions`) — an export feature, and §1 puts export out
  of scope for v1 outright.
- **Custom CA certificates, mutual TLS and skipping certificate verification** (D13) — Node's `fetch`
  takes its trust store from process-global configuration, so a per-connection override would be a
  cross-connection change; that deserves its own decision, in a phase that can make it for every
  HTTP-shaped adapter at once.
- **A management endpoint behind a path prefix** (`https://host/rabbitmq/api/…`) — one `options` key
  and no test coverage today; named as a follow-up rather than half-added.
- **RabbitMQ streams (the stream protocol, port 5552) and stream queues as a browsable kind** — D24
  reports the broker's refusal honestly; browsing a stream queue needs offset-based reads over a
  different protocol with a different client, which is a phase, not a branch.
- **Any behaviour change to the other nine adapters** (D42), except the additive `NodeKind` and the
  stream view's per-kind strip text, both guarded by existing specs.

## 7. Target tree at the end of P37

```
src/engine/adapters/
  registry.ts                       MOD  + the rabbitmq lazy loader (D4)
  rabbitmq/                         NEW  §11's fixed shape; no console.ts (caps.sql false)
    index.ts                        NEW  the Adapter impl: connect/children/definition/read/count/
                                         preview/mutate + the E_UNSUPPORTED describe/execute/
                                         downloadObject trio, and a no-op cancel() (D5, D7, D19)
    caps.ts                         NEW  rabbitmqCaps — stream, batch, canInsert only, cancel TRUE,
                                         exactCount FALSE, describe/sql FALSE (D7, D20, D23, D26, D28)
    client.ts                       NEW  RabbitHandle: baseUrl + Authorization + vhost scope;
                                         fields/URI resolution (D10-D12), sslmode (D13), the
                                         /api/overview probe and its four messages (D5)
    query.ts                        NEW  the ONE fetch call site: encodeSegment (D8), request/
                                         requestAll (F9 pagination), the timeout ceiling (D9),
                                         the credential-free command text (D6)
    catalog.ts                      NEW  /api/vhosts + /api/queues/{vhost} + /api/exchanges/{vhost}
                                         -> TreeNode[]; the hidden default exchange (D15, D16, D18)
    read.ts                         NEW  pollQueue (reject_requeue_true, truncate MAX_CELL_BYTES+1,
                                         the 500 clamp) and countQueue (D20-D24)
    mutate.ts                       NEW  publish-only; the five sentinels, amq.default, routed:false
                                         as E_QUERY; preview() renders the exact request (D25, D26)
    definition.ts                   NEW  queue and exchange sections + bindings + notes (D29-D31)
    errors.ts                       NEW  HTTP status + {error, reason} -> AdapterErrorCode (F16)
src/shared/
  domain/connection.ts              MOD  'rabbitmq' in the enum + DEFAULT_PORT 15672 (D10)
  domain/tree.ts                    MOD  nodeKindSchema gains 'exchange' (D34)
  domain/uri.ts                      --  UNCHANGED — rabbitmq:// falls out of the scheme rule (D12)
  protocol/page.ts                   --  UNCHANGED — the same StreamPage, unmodified (D14, D42)
  caps.ts                           MOD  the per-kind doc table gains a rabbitmq row (D41)
src/renderer/
  project/grouping.ts               MOD  exchange labels, the database->"Virtual host" override,
                                         GROUPED_KINDS gains exchange (D15, D33)
  project/icons.ts                  MOD  KIND_ICON.exchange (D33)
  project/menus.ts                  MOD  + the exchange case (D33)
  project/ConnectionDialog.vue      MOD  the RabbitMQ tile, KIND_LABEL, KIND_ACCENT ('indigo'),
                                         SUPPORTED_KINDS (D33)
  project/ProjectTree.vue            --  UNCHANGED — an exchange is a definition-only leaf (F32)
  theme/EngineIcon.vue              MOD  + the redrawn rabbit mark (D33)
  views/stream/StreamView.vue       MOD  isRabbit; the per-kind poll warning; the compose kind (D32)
  views/stream/StreamComposeMessage.vue MOD  the 'rabbitmq' shape (D32)
  views/stream/streamMutations.ts   MOD  + publishRabbitMessage (D32)
  views/shared/sqlIdent.ts           --  UNCHANGED (D35)
  editor/languages.ts                --  UNCHANGED (D35)
  project/typeGlossary.ts            --  UNCHANGED (D35)
tests/
  db/support/rabbitmq.ts            NEW  @testcontainers/rabbitmq, 4.3.5-management-alpine,
                                         an /api/overview HTTP wait strategy, memoized (D36)
  db/fixtures/0011_rabbitmq_seed.ts NEW  the topology of D38, seeded over HTTP with fetch (D37)
  db/rabbitmq.spec.ts               NEW  the 27 scenarios of §5
  db/sqs.spec.ts                     --  UNCHANGED — the StreamPage regression guard
  ui/support/rabbitmq.ts            NEW  re-export of the db harness, support/sqs.ts's own shape
  ui/rabbitmq.spec.ts               NEW  the small UI spec; Docker-gated (D39)
  ui/{sqs,kafka,tree,connections}.spec.ts  --  UNCHANGED — the D32/D33 regression guards
scripts/demo-dbs/
  docker-compose.yml                MOD  + the rabbitmq service (host port 15672) + its volume (D40)
  rabbitmq/seed.sh                  NEW  host-side curl against localhost:15672 (D40)
  seed.sh                           MOD  + the RabbitMQ stanza (host-side, like SQLite's)
  README.md                         MOD  + the RabbitMQ row
docs/
  v1/SPEC.md                        MOD  §1, §5, §5.1, §8.9, §8.10, §8.11, §11 (D41) — phasing row
                                         once implemented
  v1/design/kira-design-system/parts/_icons.html  MOD  + the i-rabbitmq symbol (D33)
  v1/plans/P37-rabbitmq-adapter.md  NEW  this document
AGENTS.md                           MOD  + the "RabbitMQ adapter (HTTP management API)" section (D41)
README.md                           MOD  + the RabbitMQ engine row and footnote (D41)
package.json                        MOD  + @testcontainers/rabbitmq (devDependency) — and NOTHING
                                         in `dependencies` (D1)
```

## 8. Acceptance checklist

**The dependency that isn't**

- [ ] `git diff package.json` shows **exactly one** added line, `@testcontainers/rabbitmq` under
      `devDependencies`, pinned exact. `dependencies` is unchanged.
- [ ] `grep -rn "rabbit" scripts/native-electron-build.sh electron-builder.yml` matches nothing.
- [ ] `grep -rn "amqp" src/ package.json` matches nothing outside comments explaining D2.
- [ ] `tests/ui/memory.spec.ts`'s RSS budget is unmoved.

**The connection**

- [ ] A RabbitMQ connection created in Fields mode prefills port **15672** and connects;
      `serverVersion` reads `RabbitMQ 4.x`.
- [ ] Each of the four connect failures produces its own message: wrong password (`E_AUTH`),
      unreachable port (`E_CONNECT`), **the AMQP port 5672** (`E_CONNECT` naming the port), a node
      with no management plugin (`E_CONNECT` naming the plugin).
- [ ] `rabbitmq://user:pass@host:15672/%2F` round-trips through *Copy URI* and connects; an
      `amqp://` URI is refused with a message naming `rabbitmq://`.
- [ ] A connection with `database` set shows exactly one vhost; one with it empty shows every vhost
      the user can see.

**The adapter**

- [ ] Tree: vhost nodes labelled "Virtual host" in the filters dialog, queues ungrouped, an
      **Exchanges** folder, the `amq.*` built-ins present, the nameless default exchange absent.
- [ ] A queue under the default vhost `/` and a queue named `weird/name ✓` both enumerate, describe,
      poll and count — the `%2F`/`encodeURIComponent` path end to end.
- [ ] Two consecutive polls leave the queue's message count unchanged and return the same messages,
      with `redelivered` true on the second.
- [ ] A `pageSize: 10_000` poll asks the broker for `count: 500` and returns at most 500 rows.
- [ ] A stream-type queue's poll carries the broker's own *"basic.get not supported by stream
      queues"*.
- [ ] A non-UTF-8 payload arrives base64 with `payload_encoding` in `attrs` and decodes byte-for-byte;
      a 100 KB payload is **marked truncated in the page** with `attrs.payload_bytes` reporting the
      real size.
- [ ] `count()` reports `messages` with `exact: false`; the pager and status line show the `~`.
- [ ] A publish lands, `affectedRows` is 1, and *Preview*'s text is the byte-identical request that
      ran; an unroutable publish is an **error**, not a success.
- [ ] `update` and `delete` ops are `E_UNSUPPORTED` naming the no-identity reason, and a mixed plan
      is refused whole.
- [ ] A read-only connection's `mutate()` sends **zero** requests.
- [ ] No `ctx.setCommand()` string produced by any operation contains the password.
- [ ] Expanding a vhost issues exactly two requests, whatever its object count.

**The seam**

- [ ] The engine picker's RabbitMQ tile renders a real mark in `indigo`, and `_icons.html` carries
      the same path.
- [ ] A RabbitMQ queue tab never auto-loads, shows the requeue-worded warning strip, and shows the
      routing key in the `key` column; the SQS tab still shows its own "consumes" wording.
- [ ] **Add message** is present and **Delete message** is absent on RabbitMQ; both are present on
      SQS.
- [ ] A queue's definition tab shows Queue / Arguments / Bindings / Consumers; an exchange's shows
      Exchange / Arguments / Bindings from / Bindings to, including an exchange→exchange binding.
- [ ] An exchange row's context menu has Open definition and no Open data; Kafka's and SQS's own
      menus are unchanged.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean on every
      commit.
- [ ] `xvfb-run -a bun run test:ui` — `smoke`, `startup`, `workbench`, `connections` and `sqlite`
      pass in an environment with no Docker; `rabbitmq` **skips cleanly** there rather than erroring.
- [ ] **verify-on-container:** `bun test tests/db/rabbitmq.spec.ts` green against a live
      `rabbitmq:4.3.5-management-alpine`. Per `AGENTS.md` this cannot run in Claude Code's Linux web
      container (the outbound policy blocks Docker Hub's blob CDN), so it must be run on the
      macOS/Colima box or in CI before the phase is called done.
- [ ] **verify-on-container:** the five facts this plan reasons about from source and documentation
      rather than from a running broker — the `.../get` response's exact field names and the
      pre-truncation `payload_bytes` (F11/D22), `reject_requeue_true`'s effect on the queue's own
      count and on `redelivered` (F12/D21), a stream queue's refusal reaching the HTTP layer as a
      legible message rather than a bare 500 (F13/D24), `{"routed": false}` for an unroutable publish
      (F14/D25), and `enable_queue_totals=true` keeping `messages` in a `disable_stats=true` response
      (F9/D18).
- [ ] **verify-on-container:** `tests/ui/rabbitmq.spec.ts` end to end.
- [ ] `bash scripts/demo-dbs/seed.sh` brings the tenth service up and seeds it, and a connection to
      `localhost:15672` browses it.
- [ ] SPEC §1, §5, §5.1, §8.9, §8.10, §8.11, §11, `shared/caps.ts`'s table, the README and
      `AGENTS.md` all describe what shipped.

## 9. Open questions for the user

The implementing session proceeds on each stated default; none of these blocks a commit.

1. **RabbitMQ's accent colour: `indigo` or `grey`?** D33 picks `indigo` (`#979fdd`) — RabbitMQ's own
   orange went to ClickHouse in P36, and of the two remaining free hues `grey` (`#9fa5ac`) is the
   one that reads as "no colour assigned" beside the palette's own `none` swatch. The
   counter-argument is that `indigo` sits close to MariaDB's `blue` in a long connection list. One
   line either way.
2. **Should the nameless default exchange appear in the tree?** D16 hides it: its name is the empty
   string, so its row, its tab title and its path segment would all be blank, and it has no bindings,
   arguments or policy to show. The argument for showing it (as `(AMQP default)`) is that it is a
   real exchange every publish from a queue tab goes through, and hiding it makes that indirection
   invisible. If it should appear, it needs a display-name concept `TreeNode` does not have today —
   `name` is documented as *"the raw identifier, used to build SQL and to copy"*.
3. **Is 500 the right poll ceiling, and should the page-size control be narrowed for RabbitMQ?** D20
   clamps at the management API's own documented list ceiling and states the clamp in the warning
   strip, leaving the 10/100/1k/10k control as it is for every other stream engine. The alternative —
   restricting the control to 10/100/500 for this kind — is more honest at the point of choice but
   makes the toolbar engine-specific in a way no other view is, and 500 is already ten times what a
   diagnostic poll usually wants.
4. **Should polling be refused outright on a read-only connection?** D27 allows it (SQS's standing
   behaviour), on the grounds that a poll is a read and removes nothing. The counter-argument is real:
   a poll *does* change observable state — messages are briefly unavailable to consumers, come back
   flagged `redelivered`, and may come back nearer the head (F12) — and a user who marked a
   connection read-only may have meant "touch nothing at all". If that is the intent, the Poll button
   should be disabled with a tooltip naming the requeue effect, which is a two-line change in D32's
   own branch.
5. **Which RabbitMQ image should the fixture and the demo stack pin?** D36/D40 pick
   `rabbitmq:4.3.5-management-alpine` (current at time of writing, F20). `4.2.9` would prove a wider
   compatibility floor; a floating `4-management` would catch upstream breakage early and make the
   suite non-reproducible. Whatever is current when this is implemented, take it and record the
   version the scenarios were actually verified against.
6. **Should a queue's definition tab show a Purge action?** Not proposed (§6). It is the operation
   users most often want from a GUI and the one this app has no existing shape for — every mutation
   here goes through `MutationPlan`'s row ops, and purge is a queue-level verb with no row. If it is
   wanted it is its own small phase: a tree/tab action, a confirmation dialog naming the message
   count, and an adapter method that is not `mutate()`.
7. **Should the connection dialog prefill 15671 when `sslmode` is set?** Not proposed, for P36 D12's
   own reason (open question 6 there): auto-switching the port on an `options` change would be the
   first time the dialog reacts to one, and a TLS user who forgets gets D5's legible connect failure.
