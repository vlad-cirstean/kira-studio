# P184 plan: SQS read-only poll visibility timeout setting in the UI

Source: `docs/v2.0/SPEC.md` row P184 (origin P183 review F3, D2). Prior design:
`P174-result-loading.md` D3 (read-only browse), `P183-review-since-p170.md` D2. Base: `a2c0d47`
(`v2.0`). Discovery used `codegraph_explore` on `sqs/read.go`, `sqs/adapter.go`,
`adapterhost/{wire,data}.go`, `views/stream/{StreamView.vue,state.ts}`, `state/tabDomain.ts`,
`shared/domain/streamFilter.ts`, `kafka/read.go` filter parse, `sqs_test.go`, UI mock stream.

Single sequential implementer. Five steps, one commit each (section 6). Stage only files named
here; never `git add -A`, never `git stash`, never `--no-verify`. Do not edit `SPEC.md`.

## 1. Decided by user

- Read-only poll visibility timeout is a setting changed directly in the SQS read UI.
- Default stays 1 s. UI states the trade-off.
- Validated: SQS allows 0 to 43200 s; SDK cannot send 0 (omitted as unset), so floor is 1 s.
- Confirm dialog names chosen timeout and redrive limit.

## 2. Current source (re-read on base)

- `sqs/read.go`: `browseVisibilityTimeout = 1` const; `receiveInput(queueURL, batchLimit,
  readOnly)` sets `input.VisibilityTimeout = browseVisibilityTimeout` only when read-only.
  `pollQueue` loops `ReceiveMessage` (`receiveLimit` 10, `waitTimeSeconds` 1) until page size,
  short batch, or (read-only) a batch adding nothing or holding a repeat `MessageId` (`pushBatch`
  `sawDup`, P183). `op.SetCommand("ReceiveMessage " + queueURL)`. `fetchQueueAttributes` reads
  queue `VisibilityTimeout` and `RedrivePolicy.maxReceiveCount` (best effort).
- `sqs/adapter.go` `Read`: `requireClient`, `resolveQueueTarget`, `resolveQueueURLCached`, then
  `pollQueue(..., a.state.Load().readOnly)`. `req.Filter` is never read by SQS today.
- Request wire: `adapterhost.ReadRequestWire` is JSON (`data-ops.ts` mirror), not FlatBuffers. It
  already carries a generic `filter *string` (`validFilter`: 4096 UTF-16 units max). Kafka
  carries its positioning knobs there as JSON (`streamFilter.ts` `encodeKafkaStreamFilter`,
  `kafka/read.go` `parseStreamFilter`, error `adapters.New(adapters.CodeQuery, "malformed stream
  filter", err)`), by explicit design "not a wire schema change".
- Response wire: `StreamPage` already has `visibility_timeout_seconds` (queue attribute) and
  `max_receive_count`. Nothing new needed in `wire.fbs`.
- `Dispatcher.Read` caches by a key including `Filter`; `streamViewStore.poll` invalidates before
  `load`, so a cached page never answers a Poll.
- Frontend: `stream/state.ts` `load` sends `filter: currentStreamFilter(tab)` (Kafka-only
  encoding, null for SQS); `runCount` sends the same. Runtime `receiveAcknowledged` (in memory).
  `fetchRedriveLimit` reads `RedrivePolicy` off `control.treeDefinition`, `null` on failure or
  absence. `StreamView.vue` `onPoll` confirms once per tab via `confirmDialogStore.confirmDialog`
  with `redriveSentence(limit)`. `stream-poll-warning` `Alert` has a read-only variant. Header
  `Badge` `stream-visibility-timeout` shows the queue's own attribute ("visibility Ns").
- Tab state: `streamTabStateSchema` (zod) in `state/tabDomain.ts`, persisted through the tabs
  Pinia store (`patchStreamTabState`, `TabsService.Save`). Go never parses stream tab state.
- Tests: `sqs_test.go` `TestSqs_Read_ReadOnlyPollKeepsMessagesVisible` (LocalStack, nil filter,
  1 s default). `tests/ipc/sqs/sqs.frontend.spec.ts` + `ipcfixture/sqs_test.go` cover a
  **writable** connection only (`filter` null, command "ReceiveMessage <url>" in the recorded
  fixture). No UI spec covers a read-only SQS tab.

## 3. Decisions

### D1. Value lives in persisted per-tab state

`streamTabStateSchema` gains `sqsVisibilityTimeoutSeconds`, default 1. Requirement: the right
timeout depends on the queue's consumers, and a tab is one queue; tab state already persists and
restores through the tabs store, and zod's default fills old rows with no migration. Per
connection was declined: one connection lists many queues with different consumers, and it needs
a connection-config field plus storage/dialog change for one browse knob. Not TanStack Query: this
is client state, not fetched server state. No new Pinia store: the tabs store already owns tab
state (one concern); the stream view store owns runtime only.

Schema: `z.number().int().min(1).max(43200).catch(SQS_DEFAULT_VISIBILITY_TIMEOUT_SECONDS)` so a
missing or corrupt persisted value falls back to 1 instead of failing the tab's parse. Implementer
confirms `.catch` covers the missing-key case under the zod version in use; otherwise chain
`.default(...)` too. Kafka tabs carry the field unused (stream tab schema is shared).

### D2. Wire path: the existing generic `filter`, no contract bump

Read-only SQS polls send `filter` = `{"visibilityTimeoutSeconds": N}` (always explicit, default
included, so the request carries exactly the value the confirm dialog named). Same precedent as
Kafka: no `ReadRequestWire` field, no `wire.fbs` change. No contract bump: `ContractVersion` /
`CONTRACT_VERSION` version the Space git protocol only (ARCHITECTURE `gitrpc` section); Studio's
JSON data-plane request has no version. No fixture changes: writable SQS keeps `filter: null`, and
recorded fixtures cover writable only.

Count keeps `currentStreamFilter` (null for SQS): `countQueue` ignores filter, and changing count
payloads would gain nothing.

`packages/shared/domain/streamFilter.ts` adds:

- `SQS_MIN_VISIBILITY_TIMEOUT_SECONDS = 1`, `SQS_MAX_VISIBILITY_TIMEOUT_SECONDS = 43200`,
  `SQS_DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 1`.
- `interface SqsStreamFilter { visibilityTimeoutSeconds: number }` and
  `encodeSqsStreamFilter(filter): string`.
- Update the file's header comment: SQS now carries one knob there (read-only only).

### D3. Go validation and application

`sqs/read.go`:

- `sqsStreamFilter struct { VisibilityTimeoutSeconds *int \`json:"visibilityTimeoutSeconds"\` }`
  and `parseStreamFilter(raw *string) (int, error)` returning the read-only hide seconds:
  nil filter gives `defaultBrowseVisibilityTimeout` (1, renamed from `browseVisibilityTimeout`);
  `json.Decoder` with `DisallowUnknownFields`; non-integer (1.5, string) is a decode error; a
  missing field gives the default; outside `[1, 43200]` is an error. Errors use
  `adapters.New(adapters.CodeQuery, "visibility timeout must be a whole number of seconds from 1
  to 43200", err)` / `"malformed stream filter"` for bad JSON, matching Kafka. Constants
  `minBrowseVisibilityTimeout = 1`, `maxVisibilityTimeout = 43200` with a one-line comment (SQS
  range 0 to 12 h; SDK drops 0).
- `pollQueue` takes `browseSeconds int` (parsed by caller); `receiveInput(queueURL, batchLimit,
  readOnly, browseSeconds)` sets `VisibilityTimeout = int32(browseSeconds)` when read-only.
- Read-only `SetCommand` text: `"ReceiveMessage " + queueURL + " VisibilityTimeout=" + N`, so the
  ops log shows the applied value. Writable text unchanged (recorded fixture depends on it).
- Writable connections parse and validate a present filter (a malformed request fails loudly) but
  ignore the value: they keep the queue's own timeout, which receipt-handle validity
  (`receiptHandles`, `visibilityTimeout` in `pushBatch`) depends on.

`sqs/adapter.go` `Read`: parse the filter **first**, before `requireClient`. Bad input never
reaches AWS, and the validation conformance test runs without Docker.

### D4. Interaction with repeat-batch stop and poll duration

- Poll duration is roughly ceil(pageSize/10) round trips (each at most `waitTimeSeconds` 1 s on an
  empty queue). Timeout shorter than that: messages from early batches can reappear in later
  ones; dedupe plus P183's stop-at-first-repeat-batch ends the poll early, so the page can hold
  fewer messages than the page size. Behavior unchanged; only the window length changes.
- Timeout longer than the poll: no repeats within one poll, page fills to page size or until the
  queue's visible messages run out. A second Poll inside the window skips messages still hidden
  (they look absent). Real consumers also cannot receive them until the window ends; on a FIFO
  queue, the message group stays locked that long.
- Keep the repeat-batch stop for every value (cheap; still guards a timeout shorter than one
  batch's round trip under latency). Update its comment from "short visibility window" to "the
  visibility window lapsed".
- Stop/cancel mid-poll cannot release hidden messages early: a read-only poll keeps no receipt
  handles. `ChangeMessageVisibility` release was declined: it is a write call on a read-only
  connection and needs `sqs:ChangeMessageVisibility`, which a least-privilege read-only principal
  may lack. Stated in the UI hint (D5) and ARCHITECTURE.

### D5. UI

`StreamView.vue`, read-only SQS only (`isReadOnlyBatch`), main toolbar, directly before Poll:

- shadcn-vue `InputGroup variant="kira"` + `InputGroupInput` (same primitive as Kafka's offset
  field), leading label `hide`, trailing `s`, `type="number"`, `min=1`, `max=43200`, `step=1`,
  `inputmode="numeric"`, `class="w-24"`-ish Tailwind width, `data-testid="stream-poll-visibility"`.
  Local draft `ref` seeded from `tab.state.sqsVisibilityTimeoutSeconds` (component keyed by tab id,
  same as `offsetText`). Commit on Enter/blur only when valid.
- Validation: draft must be an integer in `[1, 43200]`. Invalid: `aria-invalid`, inline error
  `data-testid="stream-poll-visibility-error"` ("Whole seconds from 1 to 43200 (12 h)"; SQS's own
  0 is not sendable, say so in the tooltip), and Poll `:disabled` with tooltip naming the error.
- `Tooltip` on the field: "How long each received message stays hidden from other consumers.
  Longer avoids receiving a message twice in one poll; shorter keeps messages available to
  consumers. 1 s minimum: the AWS SDK cannot send 0. Stop does not unhide messages early."
- `stream-poll-warning` read-only variant replaces its text with: "Each poll hides received
  messages from other consumers for {duration} and raises their receive count. A longer hide
  avoids receiving the same message twice in one poll but keeps it from consumers that long; a
  short hide can end a poll early." Plus the existing redrive sentence when known.
- Confirm dialog (`onPoll`): "Each poll hides received messages from other consumers for
  {duration} and raises their receive count. {redrive}. Poll anyway?" where `{redrive}` is
  "This queue moves a message to its dead-letter queue after N receives", "This queue has no
  redrive limit", or "Its redrive limit could not be read". `fetchRedriveLimit` returns
  `number | 'none' | null` to tell absence (definition loaded, no `RedrivePolicy` row) from
  failure; `redriveSentence` maps all three. Page path: a non-null `page.maxReceiveCount` is used
  directly, otherwise fetch (current order).
- `{duration}`: small local formatter: whole hours as "N hours", whole minutes as "N minutes",
  else "N seconds" (singular for 1). Not exported, no unit test (trivial).
- Changing the committed value clears `receiveAcknowledged`, so the next Poll confirms again with
  the new value. New stream view store action `setPollVisibilityTimeout(tabId, seconds)` patches
  tab state (`patchStreamTabState`) and clears the flag.
- Header badge on a read-only SQS tab reads "queue visibility Ns" so the queue attribute is not
  mistaken for the poll's own hide. Writable label unchanged (ipc-frontend spec asserts nothing on
  it, but keep it stable).

`stream/state.ts` `load`: when the tab's connection is a read-only batch connection (caps
`pagination === 'batch'` and record `readOnly`, read from the connections store, not a kind
check, per ARCHITECTURE's caps-only rule), send `encodeSqsStreamFilter({ visibilityTimeoutSeconds:
tab.state.sqsVisibilityTimeoutSeconds })`; otherwise `currentStreamFilter(tab)`. Factor as
`readFilter(tab)` next to `currentStreamFilter`.

Every touched SFC stays `<script setup lang="ts">`, Tailwind utilities only, no `<style>` block.

## 4. Tests (CLAUDE.md bar)

- **SQS adapter conformance** (`adapters/sqs/sqs_test.go`, exempt suite):
  - `TestSqs_Read_RejectsInvalidVisibilityTimeout`: no Docker; unconnected `newAdapter(t)`;
    table of filters `0`, `43201`, `1.5`, `"30"`, `{"visibilityTimeoutSeconds":30,"x":1}`, `{`;
    each `Read` returns an error with the query code (assert code via the adapters error type, as
    other conformance tests do). Proves validation runs before connection use.
  - `TestSqs_Read_ReadOnlyPollUsesChosenVisibilityTimeout`: LocalStack; fresh queue with
    `VisibilityTimeout` 60; send 3; read-only connect; poll with
    `{"visibilityTimeoutSeconds":4}`: 3 rows, `op` command contains `VisibilityTimeout=4`;
    immediate second poll: 0 rows (still hidden); sleep 5 s; third poll: 3 rows (released well
    before the queue's 60 s). Keep the existing nil-filter 1 s test as the default's coverage.
- **UI spec** `apps/kira-studio/tests/ui/sqs-poll-visibility.spec.ts` with support
  `tests/ui/support/sqsFixture.ts`. Derive data from the captured `tests/ipc/sqs/sqs.fixture.ts`
  (connect caps, tree children, orders-queue page, definition), not hand-written pages: patch the
  connection summary to `readOnly: true` and re-key the read snapshot's payload with the filter
  under test. One scenario:
  - default field shows 1; warning text names "1 second" and the trade-off;
  - type `0`, then `43201`: error shown, Poll disabled; type `30`, blur;
  - Poll: confirm dialog text contains "30 seconds" and "after 3 receives". The captured orders
    queue definition has no `RedrivePolicy` row (checked on base), so the support file appends
    one (`{"maxReceiveCount":3,...}`) to that definition snapshot; accept;
  - `stream.ops()` holds one `DATA_OP.read` whose payload `filter` is
    `{"visibilityTimeoutSeconds":30}`; rows render;
  - change to `60`, Poll again: confirm shows again with "1 minute".
- No new unit tests: the formatter, encoder and schema default are below the bar.

## 5. File ownership

| File | Change |
| --- | --- |
| `apps/kira-studio/internal/adapters/sqs/read.go` | D3 parse/validate, `receiveInput`, command text, comments |
| `apps/kira-studio/internal/adapters/sqs/adapter.go` | `Read` parses filter first |
| `apps/kira-studio/internal/adapters/sqs/sqs_test.go` | two conformance tests |
| `packages/shared/domain/streamFilter.ts` | SQS constants, `SqsStreamFilter`, encoder, header comment |
| `apps/kira-studio/frontend/src/state/tabDomain.ts` | schema field, `defaultStreamTabState` |
| `apps/kira-studio/frontend/src/views/stream/state.ts` | `readFilter`, `setPollVisibilityTimeout`, `fetchRedriveLimit` tri-state |
| `apps/kira-studio/frontend/src/views/stream/StreamView.vue` | D5 UI |
| `apps/kira-studio/tests/ui/sqs-poll-visibility.spec.ts` | new UI spec |
| `apps/kira-studio/tests/ui/support/sqsFixture.ts` | new support file |
| `docs/ARCHITECTURE.md` | SQS read policy paragraph and SQS section |
| `docs/v2.0/plans/P184-sqs-poll-visibility-setting.md` | Result section |

If typecheck or a unit spec breaks on the new tab-state field (fixtures building `StreamTabState`
literals), fix those call sites in the same commit and name them in Result.

## 6. Steps (one commit each)

1. Go adapter: D3 in `read.go` and `adapter.go`, both conformance tests. Commit
   `feat(sqs): read-only poll takes its visibility timeout from the stream filter`.
2. Shared + state: `streamFilter.ts`, `tabDomain.ts`, `stream/state.ts` (D1, D2, `readFilter`,
   `setPollVisibilityTimeout`, `fetchRedriveLimit`). Commit
   `feat(stream): persist and send the SQS read-only visibility timeout per tab`.
3. UI: `StreamView.vue` (D5). Commit
   `feat(stream): visibility timeout field, trade-off text and confirm for read-only SQS polls`.
4. UI spec + support fixture. Commit `test(stream): read-only SQS poll visibility setting`.
5. Docs: ARCHITECTURE SQS read policy (user-set hide 1 s to 12 h, default 1 s, per tab, sent in
   `filter`, ops command shows it, Stop cannot unhide), plus this plan's Result section (checks
   run, deviations, anything not run). Commit `docs: P184 SQS read-only visibility setting`.

Fast checks (typecheck, lint, Go build/vet) per commit via the hook. Expensive checks once, after
step 4; fixes land as follow-up commits before step 5.

## 7. Checks

- `bun run typecheck`, `bun run lint`, `bun run lint:dead` (no new findings beyond base),
  `bun run lint:go`.
- `go build ./...`, `go vet ./...`.
- `go test -race ./apps/kira-studio/internal/adapters/sqs/... ./apps/kira-studio/internal/adapterhost/...`
  and `./apps/kira-studio/internal/ipcfixture/...` SQS scenario (writable path unchanged). Docker
  per `docs/DEV_ENVIRONMENT.md` (start `dockerd`, mirror `localstack/localstack:4`). If Docker
  cannot run, say so in Result; the no-Docker validation test still runs.
- `bun test` for touched unit areas: `apps/kira-studio/tests/unit/sqs-mutation-never-polls.spec.ts`
  plus any unit spec referencing `streamTabStateSchema`/`defaultStreamTabState` (grep).
- Playwright: `bun run build:test:studio`, then
  `node node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts --project=ui sqs-poll-visibility`
  and `--project=ipc-frontend sqs` (writable SQS unchanged).

## 8. Out of scope

- Writable connections' timeout (stays the queue's own; receipt handles depend on it).
- Releasing hidden messages on Stop (`ChangeMessageVisibility`), see D4.
- Kafka filter, count path, `dbmcp` (cannot reach SQS).

## Result

Five commits on `p168-stream-a`, in plan order:

1. `900ca3b` Go adapter: `parseStreamFilter`, `receiveInput` takes the hide seconds, read-only command text shows `VisibilityTimeout=N`, `Read` parses the filter first; two conformance tests.
2. `c598b5a` Shared encoder and constants, tab state field, `readFilter`, `setPollVisibilityTimeout`, `fetchRedriveLimit` tri-state. `StreamView.vue` got a type-only tweak to `redriveSentence` so the hook typecheck stayed green; step 3 rewrote it.
3. `2eb5033` UI: field, error, tooltips, warning text, confirm text, badge label. First attempt failed the `lint` hook (`text-destructive` retired alias); fixed to `text-error`, committed normally.
4. `d8baad4` UI spec and `tests/ui/support/sqsFixture.ts`.
5. This docs commit.

Checks run, all pass:

- `bun run typecheck`, `bun run lint`, `bun run lint:dead` (exit 0, no hints), `bun run lint:go`, `go build ./...`, `go vet` on the sqs package.
- Docker started (`dockerd`, `localstack/localstack:4` mirrored). `go test -race -count=1` on `adapters/sqs` (incl. both new tests and the existing nil-filter test), `adapterhost`, and `ipcfixture` (`-run 'Sqs|SQS'`).
- `bun test` for `sqs-mutation-never-polls.spec.ts` and `go-ts-vocabulary-parity.spec.ts` (the only unit spec referencing tab domain). Zod check (scratch, not committed): `.catch` alone covers a missing key and a corrupt value.
- Playwright after `bun run build:test:studio`: `ui` project in full (320 passed, includes `sqs-poll-visibility`), `ipc-frontend sqs` (1 passed).

Not run: none of the plan's checks skipped.

Deviations: none in design. `.default()` dropped from the schema; `.catch` alone suffices (plan allowed this). Poll disabled-state tooltip reuses the range hint text. No `StreamTabState` literal call sites needed fixing beyond `defaultStreamTabState`.
