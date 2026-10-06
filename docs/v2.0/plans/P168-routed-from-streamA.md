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
