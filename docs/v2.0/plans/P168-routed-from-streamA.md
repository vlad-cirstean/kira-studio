# P168 findings routed out of Stream A

Source: `P168-part4-findings.md` (Part 4 review). Each item needs a file another stream owns.
Stream A did not edit those files.

## F12 (low) kafka browse: tombstones and empty values render identically; binary payloads lossy

- Owner files: `apps/kira-studio/internal/page/builder.go` (Part 5), `apps/kira-studio/frontend/src/views/stream/page.ts` (Part 12, Stream C).
- Kafka side: `apps/kira-studio/internal/adapters/kafka/read.go:113-116` (`body := ""` when `rec.Value == nil`), `:69-70` (header nil value becomes `""`), `:89` and `:115` (`strings.ToValidUTF8(..., "�")`).
- Issue: tombstone (null value) and empty-string value both show an empty body. Protobuf/Avro values show as replacement characters with no byte form. Key handling already separates null from empty (`Key *string`); body does not.
- Suggested fix: make `page.StreamRow.Body` a `*string` (null for a tombstone), update the page builder and the stream renderer to show a null marker. Encode non-UTF-8 values as base64 with an explicit flag column or marker the renderer understands, instead of replacing bytes. Kafka side stays unchanged until both sides land: a marker emitted without the renderer change would be ambiguous text.

## F20 (low) `shared/caps.ts` engine table contradicts the Go caps it documents

- Owner file: `packages/shared/caps.ts:124-135` (Part 13, Stream C).
- Drift against `apps/kira-studio/internal/adapters/{redis,kafka,sqs,s3,mongo}/caps.go`:
  - redis `exactCount` "no (DBSIZE)" vs Go `ExactCount: true` (per-key type-length counts).
  - redis cancel "CLIENT KILL" vs a permanent no-op `Cancel` (C9); the console now races Stop instead.
  - kafka and sqs `definition` "no" vs Go `Definition: true`.
  - s3 `exactCount` "no" vs Go `ExactCount: true`.
  - mongo tree "collection (+ indexes)" vs a leaf collection (indexes moved to the definition view, P19 D5).
  - kafka `exactCount`: Go now reports `ExactCount: false` (P168 Part 4 F13 fix: offset span over-counts compacted and transactional topics).
- Suggested fix: update the table to the Go values, or replace it with a pointer to the `caps.go` files.

## P168 Part 5 F4 (low): renderer half of Part 4 F12 (stream null body)

- Owner file: `apps/kira-studio/frontend/src/views/stream/page.ts` (Part 12, Stream C).
- Source: `P168-part5-findings.md` F4. Part 5 makes `page.StreamRow.Body` a `*string`; kafka then
  writes the per-row null bit in `bodies` for a tombstone (no `wire.fbs` change; `frame.ts`
  decodes the bit as-is).
- Issue: `streamRow` (`page.ts:40`) reads `body: cached('body', page.bodies)` and never checks
  `isNull(page.bodies, row)`, so a null body still renders as `''`, same as an empty value.
- Fix: `StreamRow.body: string | null`; `body: isNull(page.bodies, row) ? null : cached('body',
  page.bodies)` (same shape as `key`/`timestamp` above it). Show a null marker (the grid's NULL
  styling) in the stream row and detail views that read `body`. Safe to land after Part 5's Go
  half; before it, no row has the bit set.
- Binary payloads: held as Part 5 F4's `design-decision` (encoding flag vs marker); no renderer
  change until that decision lands.

## P168 Part 5 F7 (low): stale wire-schema comment in fkPreview

- Owner file: `apps/kira-studio/frontend/src/views/grid/fkPreview.ts:63` (Stream C).
- Source: `P168-part5-findings.md` F7. Part 5 deleted the dead `readRequestWireSchema` (Go
  `Validate` is the wire gate). The comment still says a literal `pageSize: 2` fails
  `readRequestWireSchema` with `E_BAD_REQUEST`.
- Fix: comment-only. Say Go `ReadRequestWire.Validate` rejects a `pageSize` other than
  10/100/1000/10000 (`adapterhost/wire.go`, error code `E_QUERY`).

## P168 Part 6 F13 (low): renderer half of saved-request not-found

- Owner file: `apps/kira-studio/frontend/src/api/state/apiQueries.ts` (Part 10, Stream C).
- Go half landed: `CollectionsService.GetRequest`/`GetGrpcRequest` now return `E_NOT_FOUND` for a
  missing item (`ipcerr.NotFound`), `E_BAD_REQUEST` for a folder or other-protocol item,
  `E_INTERNAL` for the rest.
- Fix: `apiSavedRequestQueryOptions` returns `null` only for `E_NOT_FOUND`, rethrows every other
  code so a transient failure is not cached as "deleted".

## P168 Part 6 F11 (low): mask parity fixtures

- Owner: `apps/kira-studio/tests/fixtures/mask/` (Part 12, Stream C).
- Go-parity code fix landed in `packages/shared/domain/mask.ts` (Go whitespace set, `\p{Nd}`).
- Add hand-written fixtures from the Go output: U+FEFF inside a name (`Ann\uFEFFLee`: Go keeps one
  word) and an Arabic-Indic date tail (`2024-01-01T١٢:00`).

## P168 Part 6 F19 (low): optional explain-plan fixture

- Owner: `apps/kira-studio/tests/fixtures/explain-plans/` (Part 12, Stream C).
- Go `formatJSNumber` now matches JS `String(n)`; `parse_test.go` pins the notation switches. A
  shared fixture with a large untyped numeric key (`1234567.5`, `2e20`) is optional.

## P168 Part 7 F17 (low): raw HTTP editor Apply drops disabled header rows and descriptions

- Owner file: `apps/kira-studio/frontend/src/api/state/raw.ts` (Part 10, Stream C).
- Source: `P168-part7-findings.md` F17. `generateRawRequest` emits enabled header rows only and
  `parseRawRequest` returns rows with `description: ''`; `applyEditRaw` (`raw.ts:81-87`) passes
  `result.state` to `patchHttpRequestTabState`, replacing `headers` wholesale.
- Issue: a no-edit Edit-as-raw Apply deletes every disabled header row and blanks every header
  description.
- Fix: in `applyEditRaw`, build the patched `headers` by giving each parsed row the description
  of the first not-yet-used original row with the same name and value, then append the original
  disabled rows in their original order. No api-core change needed.

## P168 Part 7 F18 (low): renderer half of history elision flags

- Owner files: `apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue`,
  `RawExchangePane.vue`, `apps/kira-studio/frontend/src/views/grpcrequest/ResponsePane.vue`
  (Part 10, Stream C).
- Source: `P168-part7-findings.md` F18. The Part 7 fixer adds `requestFieldsElided` to the
  response-history snapshot and `metadataElided` to the gRPC history snapshot (Go model, `Get`,
  `SD/response-history.ts`, `SD/grpc-history.ts`).
- Issue: a stored entry whose request fields (HTTP) or metadata/header/trailer (gRPC) were
  dropped by the history size backstop renders as empty with no note.
- Fix: where each pane already shows its body-truncated note for a history entry, show "request
  field values were not stored (too large)" when `requestFieldsElided`, and the gRPC equivalent
  for `metadataElided`. Land after the Part 7 Go/SD half; before it the field is absent.

## P168 Part 12 F17 (medium): Kafka tombstone UI assertion, blocked on Docker

- Owner files: `apps/kira-studio/tests/ipc/kafka/kafka.frontend.spec.ts`, `kafka.fixture.ts`, `apps/kira-studio/internal/ipcfixture/kafka_test.go` (Part 5).
- Not done in Part 8: the fixture needs a Docker recapture (`KIRA_IPC_FIXTURES=write`) and Docker is unavailable in the sandbox. Tracked as `SPEC.md` P171.

## P168 Part 22 F8 (low, optional): abort hook for a composed agent launch that fails to open

- Owner files: `internal/terminal/bound.go` (Part 8, Stream A), `apps/kira-space/internal/ade/tracker.go`
  (Part 20, Stream B). Part 22 owns only the `main.go` wiring line.
- Source: `P168-part22-findings.md` F8, carrying Part 20 F2 (`P168-routed-from-streamB.md`).
- Issue: `BoundService.Open` runs `ComposeAgent` (`Tracker.Compose` persists a running row), then
  `OpenWithCoalescedOutput` can still fail. The row stays running until the 30 s grace
  `Reconcile`; a fresh row's Claude session id never ran, so resuming it fails.
- Fix: `AbortAgent func(terminalID string)` beside `ComposeAgent`, called on every failure after a
  successful compose. `Tracker.Abort(terminalID)` drops the in-memory maps and grace timer, deletes
  a fresh row or marks a resumed one stopped, fires `OnChange`. `main.go` wires
  `AbortAgent: adeTracker.Abort`.
