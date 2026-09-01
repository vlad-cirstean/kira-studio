# P11 — FlatBuffers on the data plane

> **What this phase is.** P4 (`docs/v1.1/plans/P4-fe-be-data-transfer-protocol.md`) audited the
> FE↔BE data plane, fixed the Go encoder (its C1), specified a binary successor envelope in its §5,
> and deferred building it behind three named triggers (R5/D5). **This phase supersedes P4's R5 and
> D5.** None of P4's three triggers fired; what changed instead is that a candidate P4 never
> considered — FlatBuffers — was measured, and it wins on the axis P4 rejected every other
> off-the-shelf option for: it costs *less* wire overhead than P4's own hand-built envelope at every
> page size including a single row, it decodes zero-copy (the property P4 said protobuf and msgpack
> forfeit), and its JS runtime is **2.7 KB gzip** — against Arrow-JS's 51.4 KB, the bundle cost P4's
> D4 declined Arrow over on the eve of P5 (RAM).
>
> **The decision is made and is not re-litigated here.** This plan is the *how*: the exact schema,
> the exact toolchain and pin, the exact commit sequence, and the exact correctness proof for a
> deliberate wire-format break.
>
> **In one line: every Go→renderer data-plane frame becomes one FlatBuffers `Frame` table with the
> `"KIF1"` file identifier; renderer→Go frames stay JSON text; `packages/shared/protocol/page.ts`'s
> `TextColumnChunk`/`Page` types and every `isNull`/`cellText`/`isTruncated` consumer are
> untouched.**
>
> **What P4 got right and this plan keeps.** The two-plane split (D1), the control plane as
> Wails-generated bindings (untouched here), the `-tags server` build tag as the network-split answer
> (F3), the three-layer backpressure design (F5), and the observation that the encoding is isolated
> behind exactly two functions (F4) — which is precisely why this change is a localised build and not
> a migration.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands after P4's C3, with every finding below checked against
source read in this container, never against P4's own prose — `docs/v1.1/README.md`'s standing rule.

| Claim | Evidence |
|---|---|
| P4 landed in full | `grep -rn "MarshalJSON\|Uint32LE" apps/kira-studio/internal/page/` → nothing; `chunk.go:45-50` is `Chunk{Data,Offsets,Nulls,Truncated []byte}` with plain tags; `builder.go` declares `Kind` first on all four page structs; `docs/PERF.md` §2.6 exists |
| Data-plane payload surface is 9 responses, 2 of which carry pages | `adapterhost/wire.go`: only `ReadResponse.Page` and `ExecuteResponse.Pages`; the other seven are 1–5 scalar fields (`CountResponse`, `PreviewResponse`, `MutateResponse`, `ObjectDownloadResponse`, `pingPayload`, `enginecache.CacheStats`, and `struct{}{}` for `data:invalidate`/`cache:clear`) |
| Nothing outside `internal/page` reads a chunk buffer directly | `grep -rn "\.Offsets\|\.Nulls\b" apps/kira-studio --include='*.go'` outside `internal/page/` → only `internal/tree`'s and the adapters' own unrelated `Truncated *bool` catalog field. Chunk access is `page.IsNull`/`page.CellText` only (`ipcfixture/decode.go:57-66`, `adapters/testsupport/spec.go:56`) |
| No adapter touches the wire | `internal/adapters/postgres/read.go:193` is `page.NewTabularPageBuilder(columns)` → `AppendRow` → `Finish(position)`. Every adapter uses the same builder API |
| `tests/ipc` fixtures are format-agnostic | `ipcfixture/decode.go`'s `DecodePage` records **logical** `Logical*Page` structs built from `page.IsNull`/`page.CellText`, dropping `fetchedAt`/`byteSize`. Confirmed by reading the file, not by trusting P4 F7 |
| The UI tier serves the **real** Wails runtime | `tests/ui/support/mockRuntime.ts:31,264` routes `/wails/runtime.js` to `$(go env GOPATH)/pkg/mod/…/bundledassets/runtime.js`. So `Stream()`/`JSONStream()` in a UI test are the real functions; only `window._wails.streamFactory` is faked |
| Wails' `Stream()` is exported and typed | `runtime.debug.js:43` (`Stream: () => Stream`) and the export list at :3888; `node_modules/@wailsio/runtime/types/stream.d.ts:56` — `export declare function Stream(name: string): WailsSocket | WebSocket` |
| A desktop inbound payload is an `ArrayBuffer` at offset 0 | `runtime.debug.js:3806` — `decodeFrames` does `buf.slice(off, off+len)`, a fresh `ArrayBuffer`. `WailsSocket.binaryType` defaults to `"arraybuffer"` (:3313) and `_decode` is identity for `Stream()` (:3327) |
| Toolchain is reachable and version-aligned | `proxy.golang.org` lists `github.com/google/flatbuffers v25.9.23+incompatible`; `registry.npmjs.org/flatbuffers/latest` is `25.9.23`; all three `flatc` v25.9.23 release assets return `206` through this container's proxy |

**Measurement provenance, stated once.** §2's FlatBuffers/Arrow/Cap'n Proto overhead and bundle
numbers come from the throwaway programs described there — the real `flatbuffers` and
`apache-arrow` npm packages plus a real esbuild bundle, and a Go program driving
`flatbuffers.Builder` over a `Page{chunks:[Chunk]}` shape copied from `internal/page/chunk.go`.
Nothing was committed (the P58a M2 / `docs/PERF.md` §2.5 convention). §7's C4 re-measures on the
real schema and the real tree; §2's numbers are the *basis for the decision*, not the record.

### 0.2 Scope

1. Define the `.fbs` schema covering `Chunk`, all four page kinds, and the response frame (§5).
2. Pin and provision the `flatc` toolchain and both runtimes, and decide the generated-code policy (§4, §7 C1).
3. Cut the Go encoder and the TS decoder over, atomically, with no compatibility path (§7 C3).
4. Rebuild the JS test mock on the real generated encoder (§7 C2, C3).
5. Prove *logical* equality across all four page kinds and the edge cases P4 §8.3 enumerated (§8.3).
6. Re-measure and record in `docs/PERF.md` §2.7 and `docs/ARCHITECTURE.md` (§7 C4, C5).

### 0.3 Not in this phase

- **The control plane.** Twelve bound services keep the Wails-generated bindings exactly as they are. `apps/kira-studio/frontend/bindings/` is untouched.
- **The request direction.** Renderer→Go frames stay JSON text (D3).
- **Any change to `packages/shared/protocol/page.ts`'s public types or accessors.** `TextColumnChunk`, `Page`, `isNull`, `cellText`, `cellByteLength`, `isTruncated`, `chunkByteSize`, `pageByteSize`, `assertPageStructure` and the four TS page builders all keep their exact current signatures and semantics (D8). The ~20 frontend files that consume them are untouched.
- **Any adapter change.** `internal/page`'s builder API is unchanged (D7).
- **L2 cache tuning.** `internal/enginecache` is not edited at all (D9).
- **`adapterhost.Session`'s queue bounds.** Still P5's, per P4 D8/OQ-3.
- **`.github/workflows/*.yml`.** Same `workflow`-scope constraint P1 D10, P3 D15 and P4 §0.3 recorded, and `AGENTS.md`'s one Known-open-item. The *staged* replacement workflows under `docs/v1/plans/p58-pending-ci-workflows/` are docs, not workflows, and C5 adds one line to their README (D12).
- **Editing P4's plan doc.** `docs/v1.1/README.md`: plans are "never edited afterward" and "neither is retro-edited to track a later change." P4 stays exactly as written; `docs/ARCHITECTURE.md` — which that same README names authoritative — is what gets repointed (D13).

### 0.4 Ground rules

- **Every decision in §4 cites a finding; every finding cites something read or run here.**
- `AGENTS.md`'s standing rules apply: **no dual-format decoder, no compatibility shim, no stub.** Both ends ship in one binary; a frame that does not carry the `"KIF1"` identifier is a hard error, not a fallback.
- **The cutover is one commit (C3), because it has to be.** A wire format has two ends and no shims are allowed, so a commit that changes only one end is a broken tree. C1 and C2 exist specifically to shrink C3 to the part that genuinely cannot be split.
- **No new unit test is added, and one existing one is rewritten.** `tests/unit/bridge-port.spec.ts` earns its keep under `AGENTS.md`'s bar (id correlation, timeout, close-rejects-all, and the P2 R2 "a decode failure must reject rather than hang" rule — interacting rules, not a round-trip); its two base64-specific cases become obsolete and are deleted rather than translated (D11).
- **The correctness claim is logical equality, not byte identity.** This is a deliberate wire change. §8.3 specifies the proof precisely, in the shape P4 §8.3 used.

---

## 1. Findings — what has to change, and what does not

### F1 — The bulk surface is two response fields, and the rest of the frame is scalars

`adapterhost/wire.go` carries pages in exactly two places: `ReadResponse{Page page.Page; Source string}` and `ExecuteResponse{Pages []page.Page}`. Everything else answered on the data plane is small and flat:

| Op | Payload today | Fields |
|---|---|---|
| `data:read` | `ReadResponse` | page + `source` |
| `data:execute` | `ExecuteResponse` | `pages[]` |
| `data:count` | `CountResponse` | `value int64`, `exact`, `at int64`, `stale`, `source` |
| `data:preview` | `PreviewResponse` | `statements []string` |
| `data:mutate` | `MutateResponse` | `affectedRows int` |
| `data:objectDownload` | `ObjectDownloadResponse` | `bytes int64` |
| `data:invalidate`, `cache:clear` | `struct{}{}` | — |
| `ping` | `pingPayload` | `pong`, `enginePid`, `at int64` |
| `cache:stats` (res **and** evt) | `enginecache.CacheStats` | six ints |
| any failure | `wireError` | `message`, `code` |

That is a nine-member union plus an error table — small enough that "everything in FlatBuffers" is a schema of ~15 tables, not a modelling project. This is the finding that makes D2 (full-frame FlatBuffers, not a JSON-header hybrid) cheap.

### F2 — `page.Chunk`'s four buffers map onto FlatBuffers vectors with no accommodation at all

`chunk.go:45-50` is `Data []byte` (packed UTF-8), `Offsets []byte` (`rowCount+1` LE uint32s), `Nulls []byte` (`1 = NULL` bitset), `Truncated []byte` (LE uint32 row indices). In FlatBuffers that is `data:[ubyte]`, `offsets:[uint]`, `nulls:[ubyte]`, `truncated:[uint]` — **four fields, zero conversions**. Every one of P4 F19's four Arrow mismatches disappears:

| P4 F19's Arrow objection | Under FlatBuffers |
|---|---|
| validity polarity inverted (`1 = NULL` here, `1 = valid` in Arrow) | `nulls` is an opaque `[ubyte]` vector; FlatBuffers has no opinion about bit polarity |
| `uint32` offsets vs Arrow's `int32` | `[uint]` is a first-class vector type |
| `truncated` has no Arrow slot | it is just another field on the table |
| only one of four page kinds is tabular | `union PageBody { TabularPage, DocumentPage, KeyValuePage, StreamPage }`, each with its own scalars |

The last row is the structural point: `KeyValuePage` carries `redisType`/`ttlMs`/`memoryBytes` and `StreamPage` carries `visibilityTimeoutSeconds` *alongside* their chunks. Arrow's RecordBatch has no concept of "a table with extra scalar fields"; a FlatBuffers table is exactly that.

### F3 — The `[uint]` choice is load-bearing, and it is what makes decode zero-copy and safe

P4 F13 recorded that a `Uint32Array` view needs a byte offset that is a multiple of 4, and that the tempting fix — copying — silently discards the entire decode win. FlatBuffers handles this structurally, but **only if `offsets`/`truncated` are declared `[uint]` and not `[ubyte]`**:

- FlatBuffers aligns a vector to its element size relative to the buffer start. A `[uint]` vector is 4-aligned; a `[ubyte]` vector is 1-aligned.
- flatc's generated TS emits `offsetsArray(): Uint32Array | null` for a `[uint]` vector — literally `new Uint32Array(bb.bytes().buffer, bb.bytes().byteOffset + pos, len)`. Zero copy, and correctly aligned by construction.
- The frame arrives as an `ArrayBuffer` at offset 0 (§0.1), so `bb.bytes().byteOffset` is 0 and the alignment guarantee holds end to end.

Declaring them `[ubyte]` would force the decoder to build `Uint32Array` views over 1-aligned data, which throws `RangeError` exactly as P4 F13 found. **This is the single most important detail in §5's schema.**

### F4 — The transport switch is one line, and P4 already proved it

`port.ts:30` is `const socket = JSONStream('engine')`. `runtime.debug.js:3489` shows `JSONStream(name)` is `Stream(name)` plus a `JSON.parse`/`JSON.stringify` wrapper. `Stream()` is exported (`:43`, and the export list at `:3888`) and typed (`stream.d.ts:56`). Both transports already carry binary: the desktop poll natively (payload is an `ArrayBuffer`, `:3806`), server mode as `websocket.MessageBinary` with the prelude setting `binaryType='arraybuffer'`.

One hazard worth pinning down rather than inheriting: `WailsSocket._message` (`:3435`) wraps the payload in a `Blob` if `binaryType === "blob"`. It defaults to `"arraybuffer"`, but `port.ts` must set it explicitly anyway — one line that removes a silent-`Blob` failure mode across three socket implementations (WailsSocket, native WebSocket, the test mock).

### F5 — The Go encoder needs no copy, because FlatBuffers' file identifier *is* the magic word

P4 §5's envelope needed a hand-built `magic u32 | headerLen u32` prefix. FlatBuffers provides the same property natively: `Builder.FinishWithFileIdentifier(root, []byte("KIF1"))` writes a 4-byte identifier at offset 4 of the finished buffer, and TS's generated `Frame.bufferHasIdentifier(bb)` checks it. So:

- `b.FinishedBytes()` is sent **directly** to `StreamSession.Send` — no header to prepend, no whole-frame `copy` (a 27 MB `memcpy` avoided on the wide fixture).
- A stale frontend meeting a new backend (or the reverse) fails loudly on the identifier check, which is exactly why P4 §5 wanted a magic word and why Wails' own `streamMagic` exists.
- The version digit is in the identifier: any incompatible schema change bumps `"KIF1"` → `"KIF2"`.

### F6 — `flatbuffers.Builder` cannot fail, which deletes two error branches

The Go builder has no error returns. `dataframe.go`'s `respond` loses its `encErr` branch entirely, and `respondError`'s hardcoded-JSON-literal fallback (`:253`) is replaced by a package-level frame built once at `init()` — a real pre-built frame, not a stub. The `len(body) > maxResponsePayloadBytes` guard stays exactly as it is; it operates on the finished frame either way.

`session.go:35`'s comment on `maxDataFrameBytes` ("base64 inflating by 1.33x") becomes wrong the moment C3 lands and must be corrected in the same commit — the pathological page now approaches the cap ~1.33x *less* readily.

### F7 — `internal/page`'s builder API is what adapters call, and none of it changes

Every adapter calls `NewTabularPageBuilder`/`AppendRow`/`Reverse`/`Finish`, `NewDocumentPageBuilder`/`Push`/`Finish`, `NewKeyValuePageBuilder`, `NewStreamPageBuilder` (`adapters/postgres/read.go:193` and its ten siblings). FlatBuffers appears **only** at a new `EncodePage` boundary called from `adapterhost`, never inside a builder. Blast radius on the adapter packages: **zero files**.

The one internal change is `Chunk.Offsets`/`Chunk.Truncated` becoming `[]uint32`. The entire rationale for their being `[]byte` is `chunk.go:39-44`, and it is a JSON rationale — *"encoding/json base64-encodes a []byte directly with no Marshaler round trip, which is the entire point (P4 D6)"*. With JSON gone that comment describes a constraint that no longer exists, and `[]uint32` is what a `[uint]` vector wants anyway. `CellText` becomes two array reads instead of two `binary.LittleEndian.Uint32` calls; `scratch.go:105,110` write `offsets[newRow+1] = uint32(cursor)` and `append(truncated, uint32(newRow))`.

### F8 — `ChunkByteSize` must keep returning the identical number, for a reason that survives the format change

`enginecache/pages.go:141` budgets L2 against `p.Size()` → `ByteSize` → `ChunkByteSize`, and `lru.go:85`'s `bytes > l.budget/2` refusal rule keys off the same number. That number is **in-memory Go bytes of the page's own buffers**, not wire bytes — it always was, and `docs/PERF.md`'s "L2 cache note (D19)" describes it that way. The wire format is therefore irrelevant to L2, **provided** `ChunkByteSize` keeps its value across the `[]byte` → `[]uint32` change:

```go
func ChunkByteSize(chunk Chunk) int {
    return len(chunk.Data) + len(chunk.Offsets)*4 + len(chunk.Nulls) + len(chunk.Truncated)*4
}
```

The `*4`s are the whole change. Get them wrong and L2 eviction changes silently. The same number is embedded in the page as `byteSize` and is what the renderer's own `window.__kiraGridRetainedBytes` (`frontend/src/main.ts:49`) reports, which `tests/ui/perf.spec.ts:202-219` and `leaks.spec.ts:279-308` assert against relatively — so those assertions hold unchanged.

### F9 — The JS mock cannot import anything, and that decides its design

`tests/ui/support/mockStreamBrowser.js`'s own doc comment (lines 1-21) explains why it is plain, uncompiled JS read with `readFileSync` and injected as a **string**: every esbuild-based TS loader this repo runs under appends `__name(fn, "fn")` call sites under `keepNames`, referencing a helper `Function.prototype.toString()` never captures. So the browser half **cannot** `import` the generated FlatBuffers bindings, and cannot import the `flatbuffers` runtime either.

Three options were considered:

1. **Hand-write a FlatBuffers writer inside the browser file.** Rejected: it makes the mock a third implementation of the *format*, not just of the encoding — strictly worse than the base64 duplication P4 F7 already complained about.
2. **`page.exposeFunction` to encode per request in Node.** Rejected: it puts a Node↔browser round trip inside the window `tests/ui/budgets.spec.ts` and `perf.spec.ts` are measuring.
3. **Pre-encode complete frames in `mockStream.ts` at install time, and patch only the `id`.** Chosen (D10).

Option 3 works because the id's byte offset is computable in Node with the runtime's own public API and shipped alongside the bytes:

```ts
const bb = new flatbuffers.ByteBuffer(bytes);
const frame = wire.Frame.getRootAsFrame(bb);
const idOffset = frame.bb_pos + bb.__offset(frame.bb_pos, ID_VTABLE_SLOT); // ID_VTABLE_SLOT from the generated code
```

The browser half then does exactly `new DataView(buf).setInt32(idOffset, id, true)` — **no FlatBuffers knowledge in the browser at all**. The encoder must call `builder.forceDefaults(true)`, or a snapshot encoded with `id = 0` would have the field omitted (FlatBuffers elides default-valued scalars) and there would be no slot to patch. Only the mock needs `forceDefaults`; the production Go encoder does not, because when the real id *is* 0 the elided field decodes to the default 0, which is correct.

This is a net deletion: `encodeChunk`, `buildPage`, `chunkByteSize`, `sumChunkBytes` and `COLUMN_ENVELOPE_BYTES` all leave `mockStreamBrowser.js`, and the TS replacement builds pages through `packages/shared/protocol/page.ts`'s **existing** `createTabularPageBuilder`/`createDocumentPageBuilder`/`createKeyValuePageBuilder`/`createStreamPageBuilder` (today used only by `tests/unit/`) rather than re-deriving offsets by hand — P50 D6's "never a hand-rolled reimplementation", finally satisfied on this path.

One wrinkle to carry: `PortSnapshot`'s `LogicalTabularPage.truncatedRows` names truncated rows explicitly, while the shared builders derive truncation from real byte lengths. The encoder therefore overrides `chunk.truncated = new Uint32Array(rows)` after `finish()` **and recomputes `page.byteSize`** via the shared `pageByteSize`/`chunkByteSize`, because the override changes `truncated.byteLength`. Skipping the recompute reintroduces P57's own `byteSize: 0` incident that `mockStreamBrowser.js:109-114` documents.

### F10 — Where the real Go encoder meets the real TS decoder is still one spec, and it only covers tabular

Unchanged from P4 F16, re-checked: `tests/e2e-real/` holds `sqlite-real.spec.ts`, `postgres-real.spec.ts`, `mariadb-real.spec.ts` — all SQL, all `TabularPage`. There is no real-backend spec for mongo (document), redis (key-value) or kafka/sqs (stream), because those need Docker. So `tests/e2e-real` is a **necessary but not sufficient** gate here: it proves the real pipeline for one page kind. The other three need the direct proof §8.3 specifies. This is P4 OQ-4 coming due exactly as it predicted.

### F11 — Four places decode or fake the wire today, and all four are in scope

| # | File | Role after C3 |
|---|---|---|
| 1 | `internal/page/*.go` + a new `encode.go` | Go encoder (FlatBuffers) |
| 2 | `frontend/src/bridge/port.ts` + a new `packages/shared/protocol/frame.ts` | TS decoder (FlatBuffers) |
| 3 | `tests/ui/support/mockStream.ts` (moved out of `mockStreamBrowser.js`) | test encoder, on the same generated code as #2's decoder |
| 4 | `tests/unit/support/{wailsRuntime,fakeSocket}.ts` + `tests/unit/bridge-port.spec.ts` | mocks `Stream` (not `JSONStream`) and delivers `ArrayBuffer` frames |

Not affected, verified against source rather than assumed: the six `tests/ipc/<adapter>/*.fixture.ts` corpora (logical, per F1's `decode.go` reading), every adapter package (F7), `internal/enginecache` (F8), and `frontend/src/bridge/data.ts` (it casts `request()`'s result to the same interfaces the decoder will produce).

---

## 2. The measurements the decision rests on

### F12 — Wire overhead, against raw buffer bytes

Built through `flatbuffers.Builder` directly (no codegen — the public untyped builder), modelling
`Page{chunks:[Chunk]}` / `Chunk{data,offsets,nulls,truncated}` against `internal/page/chunk.go`'s
real layout:

| Fixture | Raw buffers | Arrow IPC (single frame) | **FlatBuffers** |
|---|---|---|---|
| 1 row × 2 cols | 34 B | +1,194 % (406 B) | **+359 % (122 B)** |
| 3 rows × 2 cols | 178 B | +228 % (406 B) | **+69 % (122 B)** |
| 100 × 12 (default page) | 33,228 B | +6.6 % (2,188 B) | **+1.7 % (552 B)** |
| 10,000 × 12 (max page) | 3,345,096 B | +0.06 % | **+0.02 %** |
| 10,000 × 40 (wide) | 26,983,920 B | +0.02 % | **+0.01 %** |

FlatBuffers wins at every size, *including* the tiny single-row op, and does so without Arrow's
stream-schema-reuse trick — because **FlatBuffers transmits no schema at all**. Both ends already
agree on layout via code generated from the same `.fbs`. Arrow is self-describing and pays a 400+
byte schema tax on every independent frame, which on this app's traffic profile (P4 F6: human-paced,
one page per scroll/tab-switch, no stream) means *every* frame.

For scale, P4 F12's own table gives the JSON+base64 baseline: **1.33–1.36×** raw (i.e. +33–36 %) at
every size, surviving gzip at the same ratio. FlatBuffers' +1.7 % at the default page size is a
~24 % wire reduction at the size that actually ships.

### F13 — Frontend bundle cost, measured with a real bundler (esbuild, minify + gzip)

| Package | minified | **gzip** |
|---|---|---|
| `flatbuffers` | 9.0 KB | **2.7 KB** |
| `apache-arrow` | 223 KB | 51.4 KB |
| `capnp-ts` | 164 KB | 39.4 KB |

P4 D4 declined Arrow partly on *"an Arrow JS dependency in the webview bundle immediately before P5
(RAM)."* At 2.7 KB gzip that objection does not transfer: it is smaller than a single icon set, and
the generated accessor code is tree-shakeable per table.

### F14 — Ecosystem, stated because P4 D3 leaned on it

npm downloads/month (noisy and CI-inflated, directionally useful): protobufjs 325 M, `@bufbuild/protobuf` 86 M, **flatbuffers 35 M**, apache-arrow 19 M, capnp-ts 2.2 M. FlatBuffers is a Google project, first published 2016, still on a regular release cadence (v25.9.23 → v25.12.19 in the Go proxy's own tag list), with Go and TS codegen both officially supported.

**Cap'n Proto was considered and is declined.** Comparable wire overhead to FlatBuffers by calculation, but: no public untyped builder in its JS tooling (`capnp-ts` requires the full `.capnp` + `capnpc-ts` pipeline just to construct anything, so there is no cheap way to validate a design before committing to it), a far thinner JS ecosystem, 39.4 KB gzip of runtime, and its headline differentiator — built-in RPC with promise pipelining — solves a problem this app solved differently: Wails' `-tags server` build already provides the real-network transport (P4 F3), and `tests/e2e-real/` already runs on it.

### F15 — What P4 measured that still stands, unchanged

- **Go encode cost after P4 C1** (`docs/PERF.md` §2.6): 38 µs / 0.37 ms / 4.38 ms / 30.7 ms for the four fixtures, allocating ~1.00× the frame. P4 F11 put its own hand-built binary envelope at 31–44 µs / 0.18 ms / 2.3 ms / 13.2 ms — so the remaining Go-side prize is real but modest, and this phase is not primarily a Go-side CPU play.
- **Frontend decode** (P4 F13, JavaScriptCore proxy): **0.23 / 0.96 / 3.4 / 35–38 ms** today, against **0.030 / 0.026 / 0.016 / 0.06–0.14 ms** for a zero-copy envelope. This is the prize: *the whole-frame decode pass disappears*, on the webview's main thread, inside the interaction whose budget is 50 ms p95 (`docs/PERF.md` §1).

---

## 3. The comparison, on the axes that decide it

Extending P4 F21's table with the row it did not have:

| | Desktop transport | Wire vs raw | FE decode | Codegen | FE bundle | Places to change (F11) |
|---|---|---|---|---|---|---|
| **Today (post-P4 C1)** | works | 1.33–1.36× | O(frame): 0.23–38 ms | none | none | — |
| P4 §5 hand-built envelope | works | 1.00–1.06× | O(columns): 0.02–0.14 ms | none | none | 3, + a hand-built format with an alignment rule that fails silently if fudged |
| protobuf over the stream | works | ~1.00× | **O(frame)** — generated decoders copy `bytes` | yes | ~13 KB gz (`@bufbuild`) | 3 + schema |
| Arrow IPC | works | +0.02 % … **+1,194 %** | O(columns) | schema/metadata work | **51.4 KB gz** | 3 + F2's four accommodations |
| Cap'n Proto | works | ~FlatBuffers | O(columns) | yes, **and no untyped builder** | 39.4 KB gz | 3 + schema |
| gRPC / gRPC-Web | **no** (P4 F17) | ~1.00× | O(frame) | yes | — | 3 + a second transport |
| **FlatBuffers** | **works** | **+0.01 % … +1.7 %** at real sizes | **O(columns)** | yes, one `.fbs` | **2.7 KB gz** | 4, all generated from one schema |

The row that flipped the decision is column 5 against column 3: FlatBuffers is the only candidate that is *both* zero-copy on decode *and* cheap enough in the bundle to survive P5's own goals — and, unlike P4's §5 envelope, its alignment rule is enforced by the generator rather than by a comment.

---

## 4. Decisions

| # | Decision | Justified by |
|---|---|---|
| **D1** | **Adopt FlatBuffers as the data-plane response serialization, now.** This supersedes P4's R5 and D5; P4's three deferral triggers are moot. | F12/F13/F14: less wire overhead than P4's own envelope at every size including one row, zero-copy decode, 2.7 KB gzip, one schema instead of a hand-built format with three hand-maintained implementations. F2: the four-buffer chunk maps onto FlatBuffers vectors with no accommodation at all, which is precisely what Arrow could not do (P4 F19). |
| **D2** | **The entire Go→renderer frame is one FlatBuffers `Frame` table** — `kind`, `id`, `ok`, `topic`, `error`, and a nine-member payload union. No JSON header, no hybrid. | F1: the whole non-page surface is nine small payloads and one error table — ~15 tables total. F12: at 122 B for a 1-row page, per-frame overhead is no longer a reason to keep tiny frames in JSON. F5: one format means one code path, which is what `AGENTS.md`'s no-dual-path rule asks for; the alternative (JSON for small frames, FlatBuffers for pages) needs a per-frame discriminator and two decoders forever. Debuggability, the honest cost, is answered by `flatc --json`: with the schema in the repo any captured frame converts back to readable JSON, which is more than P4 §5's own envelope offered for its payload section. |
| **D3** | **Renderer→Go frames stay JSON text** on the same binary stream. `HandleDataFrame`'s `json.Unmarshal` probe and `wire.go`'s eight `Validate()` methods are untouched. | F1/P4 F18: requests are ~200 bytes at interaction rates — the measured win is zero. FlatBuffers does not express `pageSize ∈ {10,100,1000,10000}`, cursor-mode enums or 4096-char filter caps, so a FlatBuffers request adds a decode step *in front of* the same hand-written validation. It would also force `mockStreamBrowser.js`'s `matchKey` and `tests/ipc`'s fixture payload matching to decode requests. Asymmetry here is not a fallback path; it is one direction encoded per what that direction actually costs. |
| **D4** | **`offsets` and `truncated` are `[uint]` vectors; `data` and `nulls` are `[ubyte]`.** | F3: this is what makes flatc emit a zero-copy, correctly-aligned `Uint32Array` view. `[ubyte]` for the uint32 buffers would be 1-aligned and reproduce P4 F13's `RangeError` — or, worse, be "fixed" by copying, which discards the entire decode win. The Go cost is a `PrependUint32` loop instead of a `memcpy` (~120 k iterations for the maximum page; sub-millisecond), and `data` — the buffer that actually dominates — still goes through `CreateByteVector`'s single `memcpy`. |
| **D5** | **The frame's magic word is FlatBuffers' own `file_identifier "KIF1"`; there is no hand-built header and no whole-frame copy.** Bump the trailing digit on any incompatible schema change. | F5: `FinishWithFileIdentifier` + `Frame.bufferHasIdentifier` gives P4 §5's loud-failure property with zero bespoke framing, and `FinishedBytes()` goes straight to `Send` — avoiding a 27 MB `memcpy` on the wide fixture that a prefixed header would have forced. Same reasoning Wails' own `streamMagic` records. |
| **D6** | **Every 64-bit-ish numeric that crosses to JS is `double`, not `long`.** (`byteSize`, `fetchedAt`, `ttlMs`, `memoryBytes`, `count.value`, `count.at`, `ping.at`, `objectDownload.bytes`, the six `CacheStats` counters.) Small bounded integers (`rowCount`, `pageSize`, `truncatedCells`, `enginePid`, `visibilityTimeoutSeconds`, `id`) stay `int`. | flatc maps `long` to `bigint` in TS. Today these fields cross as JSON numbers and land in JS as doubles, so `double` is **exactly** today's semantics with no precision change and no `bigint` churn across `data.ts` and every downstream consumer. Every one of these values is far below 2^53. |
| **D7** | **`internal/page` keeps its entire builder API. FlatBuffers appears only at a new `EncodePage` boundary.** `Chunk.Offsets`/`Truncated` become `[]uint32`. | F7: eleven adapter packages call `NewTabularPageBuilder`/`AppendRow`/`Finish` and nothing else; blast radius there is zero files. The `[]byte` form's entire stated rationale (`chunk.go:39-44`) is an `encoding/json` rationale that no longer exists, and `[]uint32` is what a `[uint]` vector wants and what `CellText` reads more simply. |
| **D8** | **`packages/shared/protocol/page.ts` is unchanged** — same `TextColumnChunk`/`Page` types, same `isNull`/`cellText`/`isTruncated`/`chunkByteSize`/`pageByteSize`/`assertPageStructure`, same four builders. The decoder produces exactly those shapes. | ~20 frontend files consume them (grid, console, stream, keyvalue, documents, celleditor, theme, and three `tests/e2e-real` specs). Producing the identical object shape from zero-copy views is free — a `TextColumnChunk` is four typed arrays either way — so the disruption budget is spent on nothing. `assertPageStructure`'s `instanceof` and length checks stay meaningful and stay in `data.ts`. |
| **D9** | **`internal/enginecache` is not edited. `ChunkByteSize` must return the identical number** (`len(Offsets)*4`, `len(Truncated)*4`). | F8: L2 budgets against in-memory Go bytes, not wire bytes — it always did, and `docs/PERF.md`'s L2 note says so. The `> budget/2` refusal rule and the 64 MB default are therefore unaffected by a wire change. The one way to break them is to let `ChunkByteSize` drift during the `[]byte` → `[]uint32` edit, which §9 checks explicitly. |
| **D10** | **The UI mock pre-encodes whole frames in `mockStream.ts` (Node, real generated encoder) and the browser half patches only the `id` at a Node-computed byte offset.** | F9: the injected browser file cannot import anything; hand-writing a FlatBuffers writer there would make it a third implementation of the *format*; and `exposeFunction` would put a Node round trip inside `budgets.spec.ts`'s measured window. Option 3 is the only one that uses the real generated encoder, keeps the browser half dependency-free, and *deletes* `encodeChunk`/`buildPage` rather than translating them. |
| **D11** | **Generated code is committed to the repo, not gitignored**, and `scripts/generate-wire.sh` regenerates it. | The bindings precedent (`apps/kira-studio/.gitignore`: `frontend/bindings`) does not transfer: bindings are derived from constantly-changing Go service signatures and are needed only by the frontend build, whereas this is derived from one rarely-changing `.fbs` and is needed by **`go build`/`go test` themselves**. `AGENTS.md` states the fast Go loop *"needs nothing but the Go toolchain"* — gitignoring would break that and put a C++ binary in front of every Go build. It also keeps CI viable without touching `.github/workflows/` (Known open item). The cost — drift between schema and generated code — is checked by §9's regenerate-then-`git status --porcelain` gate. |
| **D12** | **`flatc` is fetched on demand into a gitignored `.tools/` cache by a dedicated `scripts/generate-wire.sh`, pinned to v25.9.23 and SHA-256-verified. `install-deps.sh` and `wails-dev-setup.sh` are not touched.** | Because generated code is committed (D11), `flatc` is needed only when the schema changes — so making it a fresh-clone prerequisite would tax every contributor for a rare operation. Fetch-on-demand mirrors how `wails-dev-setup.sh` already provisions `wails3`. Verified reachable from this container: all three release assets answer `206`. v25.9.23 is the one version where the compiler, the Go runtime (`v25.9.23+incompatible`) and the npm runtime (`25.9.23`, current `latest`) all exist — pinning the triple to one version is not a coincidence to be preserved by luck. |
| **D13** | **`docs/v1.1/plans/P4-...md` is not edited.** This plan states the supersession; `docs/ARCHITECTURE.md` is repointed from P4 to P11. | `docs/v1.1/README.md`: plans are *"committed before that phase's implementation starts and never edited afterward"*, *"never retro-edited to track a later change"*, and `ARCHITECTURE.md` *"is authoritative for the app as it stands today"*. An addendum on P4 would violate the one rule that folder exists to enforce. |
| **D14** | **No `NOTICES.md` entry for `flatbuffers`.** | `NOTICES.md:3` scopes itself to *"third-party icon assets bundled with Kira Studio's UI"* plus the two vendored typefaces. No code dependency is listed there — not `zod`, not `vue`, not `@wailsio/runtime`. Adding one would be inconsistent with the file's own stated scope. |
| **D15** | **`flatc` is run without `--gen-object-api` and without `--gen-mutable`.** | The object API materialises every field into plain objects on `unpack()` — precisely the O(frame) copying pass P4 F13 measured away and this whole phase exists to remove. The raw accessors are the point. |

---

## 5. The schema

One file: **`packages/shared/protocol/page.fbs`**, beside `page.ts`, which is where a reader already
looks for this app's protocol shapes. Every field mirrors a field that exists today in
`internal/page/builder.go` and `packages/shared/protocol/page.ts`; nothing is invented and nothing is
dropped.

```fbs
// packages/shared/protocol/page.fbs
//
// The data-plane response wire format (P11). Go encoder: apps/kira-studio/internal/page/encode.go
// plus apps/kira-studio/internal/adapterhost/frame.go. TypeScript decoder:
// packages/shared/protocol/frame.ts. Regenerate both with scripts/generate-wire.sh.
//
// Renderer -> Go frames are NOT covered here: they stay JSON text (P11 D3).

namespace wire;

// ---- page vocabulary (mirrors packages/shared/protocol/page.ts) ----

enum TypeClass : ubyte { number, text, boolean, temporal, binary, json, other }
enum Strategy  : ubyte { keyset, offset, cursor, offsetWindow, batch }
enum RedisType : ubyte { string_, hash, list, set_, zset, stream, object }
enum Source    : ubyte { cache, server }

table ColumnDescriptor {
  name:string (required);
  data_type:string (required);
  type_class:TypeClass;
  nullable:bool;
  is_primary_key:bool;
  generated:bool;
}

table PagePosition {
  offset:int = null;            // optional scalar: null == PagePosition.offset === null
  page_size:int;
  has_more:bool;
  next_token:string;            // absent == null
  prev_token:string;            // absent == null
  strategy:Strategy;
}

// P11 D4: offsets/truncated are [uint], never [ubyte] -- a [uint] vector is 4-byte aligned by
// construction, which is what lets the generated TypeScript hand back a zero-copy Uint32Array view
// instead of throwing RangeError (P4 F13).
table Chunk {
  data:[ubyte] (required);
  offsets:[uint] (required);    // rowCount + 1 entries
  nulls:[ubyte] (required);     // ceil(rowCount / 8) bytes, 1 = NULL
  truncated:[uint] (required);  // sorted row indices; usually empty, never absent
}

table TabularPage {
  columns:[ColumnDescriptor] (required);
  row_count:int;
  chunks:[Chunk] (required);    // index-aligned with columns
  position:PagePosition (required);
  truncated_cells:int;
  byte_size:double;             // P11 D6
  fetched_at:double;            // epoch ms
}

table DocumentPage {
  position:PagePosition (required);
  ids:Chunk (required);
  bodies:Chunk (required);
  row_count:int;
  byte_size:double;
  fetched_at:double;
}

table KeyValuePage {
  position:PagePosition (required);
  redis_type:RedisType;
  ttl_ms:double = null;         // optional scalar
  memory_bytes:double = null;   // optional scalar
  fields:Chunk (required);
  values:Chunk (required);
  row_count:int;
  byte_size:double;
  fetched_at:double;
}

table StreamPage {
  position:PagePosition (required);
  keys:Chunk (required);
  headers:Chunk (required);
  attrs:Chunk (required);
  timestamps:Chunk (required);
  bodies:Chunk (required);
  row_count:int;
  byte_size:double;
  fetched_at:double;
  visibility_timeout_seconds:int = null;   // optional scalar; SQS-only
}

union PageBody { TabularPage, DocumentPage, KeyValuePage, StreamPage }

// A one-field wrapper so a union can live inside a vector (ExecuteResponse.pages) without the
// parallel types-vector/values-vector shape flatc emits for [PageBody] -- simpler in both languages.
table Page { body:PageBody; }

// ---- response payloads (mirrors adapterhost/wire.go + data-ops.ts) ----

table ReadResponse           { page:Page (required); source:Source; }
table CountResponse          { value:double; exact:bool; at:double; stale:bool; source:Source; }
table PreviewResponse        { statements:[string] (required); }
table MutateResponse         { affected_rows:int; }
table ExecuteResponse        { pages:[Page] (required); }
table ObjectDownloadResponse { bytes:double; }
table PingPayload            { pong:bool; engine_pid:int; at:double; }
table CacheStats {
  l2_bytes:double; l2_budget_bytes:double; l2_entries:int;
  l2_hits:int; l2_misses:int; l3_entries:int;
}
// data:invalidate and cache:clear answer `{}` today (dataframe.go's struct{}{}).
table EmptyResponse {}

union Payload {
  ReadResponse, CountResponse, PreviewResponse, MutateResponse, ExecuteResponse,
  ObjectDownloadResponse, PingPayload, CacheStats, EmptyResponse
}

// ---- the frame (mirrors packages/shared/protocol/port.ts) ----

enum FrameKind : ubyte { res, evt }

table Error { message:string (required); code:string; }

table Frame {
  kind:FrameKind;
  id:int;              // res only; 0 on an evt frame
  ok:bool;             // res only
  topic:string;        // evt only ("cache:stats")
  error:Error;         // present iff kind == res && !ok
  payload:Payload;
}

root_type Frame;
file_identifier "KIF1";   // P11 D5 -- bump the digit on any incompatible change
```

**Notes an implementer must not lose:**

- **`truncated` is `(required)` and must always be written, even at length zero.** A `StartVector(4, 0, 4)` + `EndVector(0)` produces a real empty vector; omitting the field produces `null` from the accessor. This is the exact analogue of P4 C1 step 4's `null`-vs-`""` hazard — it fails silently on the Go side and loudly on the user's — and §8.3 covers it explicitly.
- **Optional scalars** (`field:type = null;`) are supported by flatc for both Go and TypeScript and generate nullable accessors (`*int32` / `number | null`). If the pinned flatc rejects them for either generator, the fallback is a companion `has_<field>:bool` and **not** a sentinel value; record the deviation in the commit message.
- **Enum ordinals are the wire.** Never reorder or insert an enum member without bumping the file identifier.
- **`Source`, `TypeClass`, `Strategy`, `RedisType` decode back to today's exact string literals** so `packages/shared/protocol/page.ts`'s and `data-ops.ts`'s types are unchanged (D8).

### 5.1 The generated-code contract

```
scripts/generate-wire.sh
  flatc --go --gen-onefile=false -o apps/kira-studio/internal/page  packages/shared/protocol/page.fbs
  flatc --ts --ts-no-import-ext  -o packages/shared/protocol        packages/shared/protocol/page.fbs
```

Expected output, to be confirmed on the first run and recorded in C1's commit message:

- `apps/kira-studio/internal/page/wire/*.go`, `package wire`, imported as `.../internal/page/wire`.
- `packages/shared/protocol/wire/*.ts` plus the `packages/shared/protocol/wire.ts` barrel.

If flatc's namespace→directory mapping puts them elsewhere, adjust `-o` so the files land at exactly
those paths; do not move them by hand afterwards, or the regeneration drift check in §9 fails.
`--ts-no-import-ext` avoids `.js`-specifier resolution questions in Vite and the two tsgo projects;
if `flatc --help` at the pinned version does not list it, drop it and confirm `bun run build` and
`bun run typecheck` still resolve the generated imports.

**Never pass `--gen-object-api` or `--gen-mutable`** (D15).

---

## 6. The encode and decode contracts

### 6.1 Go

New `apps/kira-studio/internal/page/encode.go`:

```go
// EncodePage writes p into b and returns the offset of the wire.Page table wrapping it.
// Callers must not have a table open on b.
func EncodePage(b *flatbuffers.Builder, p Page) flatbuffers.UOffsetT
```

Build order is inner-to-outer, as FlatBuffers requires: every `Chunk` (and every string, every
`ColumnDescriptor`, the `PagePosition`) is finished before the page table is started, and the page
table before the `Page` wrapper. A `[]uint32` vector is written as

```go
b.StartVector(4, len(v), 4)
for i := len(v) - 1; i >= 0; i-- { b.PrependUint32(v[i]) }
off := b.EndVector(len(v))
```

and `Data`/`Nulls` go through `b.CreateByteVector`.

New `apps/kira-studio/internal/adapterhost/frame.go` owns the envelope:

```go
// encodePayload writes payload into b and returns its offset and union tag.
// An unhandled payload type is a programming error and is reported as E_INTERNAL, never encoded.
func encodePayload(b *flatbuffers.Builder, payload any) (flatbuffers.UOffsetT, wire.Payload, error)

func encodeResponse(id int, payload any) ([]byte, error)
func encodeError(id int, message, code string) []byte
func encodeEvent(topic string, payload any) []byte
```

`dataframe.go` changes only inside `respond`/`respondError`/`respondPing`/`respondCacheStats`/
`pushCacheStats`; `handleDataOp`'s nine `r.respond(session, id, resp, err)` call sites are untouched
(that is what keeps this commit's diff honest). `respond`'s `encErr` branch disappears (F6); the
`len(body) > maxResponsePayloadBytes` guard stays exactly as it is. `respondError`'s hand-written
JSON literal fallback is replaced by a package-level `internalErrorFrame []byte` built once in
`init()`.

### 6.2 TypeScript

New `packages/shared/protocol/frame.ts`:

```ts
export function decodeFrame(bytes: Uint8Array): PortResponse | PortEvent;
```

It checks `wire.Frame.bufferHasIdentifier(bb)` first and **throws** on a mismatch (no fallback,
D1/D5), then switches on `payloadType()` and builds the plain objects `data.ts` already casts to.
`decodeChunk` is the whole zero-copy story:

```ts
function decodeChunk(c: wire.Chunk): TextColumnChunk {
  const data = c.dataArray(), offsets = c.offsetsArray();
  const nulls = c.nullsArray(), truncated = c.truncatedArray();
  if (!data || !offsets || !nulls || !truncated) throw new Error('chunk is missing a buffer');
  return { data, offsets, nulls, truncated };
}
```

Every one of those four arrays is a view over the received `ArrayBuffer`; nothing is copied. The
`throw` is not defensive decoration — it is genuinely reachable on a corrupt or truncated frame, and
it is the path P2 R2 fixed (a throw inside DOM event dispatch that leaves a pending promise
unsettled forever). `port.ts`'s existing `try`/`catch` discipline around `handleMessage` must be kept
verbatim.

`port.ts` changes, and only these:

1. `import { Stream } from '/wails/runtime.js'` — with the same `@ts-ignore`/`biome-ignore` block, unchanged, for the same reason its own comment gives.
2. `const socket = Stream('engine'); socket.binaryType = 'arraybuffer';` (F4 — explicit, so no implementation can silently hand back a `Blob`).
3. `socket.send(JSON.stringify(req))` — `JSONStream` used to do this (`runtime.debug.js:3547`).
4. `socket.onmessage = (ev) => handleMessage(decodeFrame(new Uint8Array(ev.data as ArrayBuffer)))`, inside the same try/catch shape.
5. **Delete** `isChunkLike`, `Uint8ArrayWithFromBase64`, `decodeBase64`, `toTypedArray`, `reviveChunks`, and the three long comments that describe the base64/index-keyed-JSON history.

`data.ts`, `views/**`, and `packages/shared/protocol/page.ts` are **not** edited (D8).

---

## 7. Implementation order

Five commits. §8.1's block runs after **each** one, not once at the end.

- **C1 before C2/C3**, because both consume the generated code.
- **C2 before C3**, because it moves the mock's encoder to where C3 can retarget it in a few lines instead of rewriting it whole.
- **C3 is atomic and cannot be split** — a wire format has two ends and `AGENTS.md` forbids a compatibility shim.
- **C4 before C5**, because C5 cites C4's numbers.

### C1 — `chore(protocol): pin the FlatBuffers toolchain and generate the data-plane wire code`

1. **`packages/shared/protocol/page.fbs`** — §5, verbatim.
2. **`scripts/generate-wire.sh`** — new, executable, `set -eu`, in the house style of `wails-dev-setup.sh`:
   - `FLATC_VERSION=25.9.23`.
   - Honour a `FLATC` environment override; otherwise use `.tools/flatc-25.9.23/flatc`, downloading it if missing.
   - Asset selection by `uname -s`/`uname -m`, with these **verified** digests (computed in this container on 2026-09-01 by streaming each asset through `sha256sum` — re-verify against the actual downloaded bytes before trusting them, since they were computed in a different sandbox instance):

     | Platform | Asset | SHA-256 (as reported by the planning agent — re-verify) |
     |---|---|---|
     | Darwin arm64 | `Mac.flatc.binary.zip` | `1e14d2feade6d109fa9c102e6e5ead68f325ed3da1d3022ce08d3222f828d983` |
     | Darwin x86_64 | `MacIntel.flatc.binary.zip` | `7a1de9cd4d0e769a39c41f3c59496bd011bc7a94d97baa58b0df8df782dc5c8d` |
     | Linux x86_64 | `Linux.flatc.binary.g++-13.zip` | `de0c6ad114a5a686ecf64322528c602c7d4512446a93f290f54f00ee5abea487` |

     Base URL `https://github.com/google/flatbuffers/releases/download/v25.9.23/`. Any other
     platform (notably Linux arm64, which has no official asset) **exits with a message naming the
     pinned version and the `FLATC` override** — never silently falls back to a `flatc` on `PATH`,
     because an unpinned compiler is exactly how generated code drifts.
   - Verify the digest, `unzip` into `.tools/flatc-25.9.23/`, `chmod +x`.
   - Assert `"$FLATC" --version` reports `25.9.23`.
   - Run the two flatc invocations of §5.1.
3. **`.gitignore`** — add `.tools/`.
4. **`package.json`** — add `"generate:wire": "sh scripts/generate-wire.sh"` to `scripts`, and `"flatbuffers": "25.9.23"` to `dependencies` (beside `zod` — both are runtime libraries the shipped bundle contains, which is the line this repo's `dependencies`/`devDependencies` split already draws). Run `bun install`; `bun.lock` changes.
5. **`go.mod`/`go.sum`** — `go get github.com/google/flatbuffers@v25.9.23` (the proxy serves it as `v25.9.23+incompatible`; commit whatever version string Go writes). Note in the commit message that the module zip carries the whole upstream repo, so `go mod download` grows.
6. **Run `bun run generate:wire`** and commit its output: `apps/kira-studio/internal/page/wire/*.go` and `packages/shared/protocol/wire/*.ts` (+ barrel). Record the exact emitted paths in the commit message (§5.1).
7. **`biome.json`** — add the generated TS paths to `files.includes` as negations (`"!packages/shared/protocol/wire"`, and the barrel file if one is emitted), matching the existing `"!dist"`/`"!docs/design"` entries. Generated code is not ours to format or lint.
8. Nothing imports the generated code yet — that is C3's job, one commit later.

**Verify:** §8.1. Additionally `go build ./apps/kira-studio/internal/page/wire/` compiles and `bun run typecheck` passes with the generated TS present.

### C2 — `refactor(tests): move the UI mock's page encoder out of the injected browser script`

A pure refactor with **no wire change** — the frames the mock emits are byte-for-byte what it emits
today, so every `tests/ui` and `tests/ipc:fe` spec stays green. This is what makes C3 small enough to
review.

1. **`tests/ui/support/mockStream.ts`** gains, in TypeScript, what `mockStreamBrowser.js:65-213` does today: `buildPage(logical): Page` and `buildResponsePayload(response)`. Build pages through `packages/shared/protocol/page.ts`'s existing `createTabularPageBuilder`/`createDocumentPageBuilder`/`createKeyValuePageBuilder`/`createStreamPageBuilder` — not a hand-rolled offsets loop (P50 D6). Where a `LogicalTabularPage` names `truncatedRows`, override `chunk.truncated = new Uint32Array(rows)` after `finish()` **and recompute `page.byteSize`** through the shared `pageByteSize`/`chunkByteSize` (F9's `byteSize: 0` hazard).
2. `mockStream.ts` serialises each snapshot's response to today's base64-JSON payload shape and passes the pre-built payloads into the injected script alongside the snapshots.
3. **`mockStreamBrowser.js`** loses `toBase64`, `encodeChunk`, `chunkByteSize`, `sumChunkBytes`, `COLUMN_ENVELOPE_BYTES`, `buildPage`, `buildResponsePayload` and their comments. What remains is: the socket shim, `matchKey`, the cursor/group bookkeeping, the `ping` special case, and `respond`.
4. `tests/ipc/support/types.ts` is untouched.

**Verify:** §8.1, plus `bun run test:ui` and `bun run test:ipc:fe` green — these must pass here, since nothing about the wire changed.

### C3 — `feat(protocol)!: carry data-plane responses as FlatBuffers instead of JSON+base64`

The cutover. A breaking wire change, so a `!` and a `BREAKING CHANGE:` footer naming the format and
the `"KIF1"` identifier.

**Go**

1. **`internal/page/chunk.go`** — `Offsets []uint32`, `Truncated []uint32`; drop the JSON struct tags on `Chunk`. `CellText` reads `chunk.Offsets[row]`/`[row+1]` directly. **`ChunkByteSize` becomes `len(Data) + len(Offsets)*4 + len(Nulls) + len(Truncated)*4` — the value must not change** (D9, §9 item 4). Rewrite the package doc comment (`chunk.go:1-8`) and the `Chunk` doc block (`:39-44`): the base64/`encoding/json` rationale is gone, replaced by the FlatBuffers one.
2. **`internal/page/scratch.go`** — `finish()` allocates `offsets := make([]uint32, rowCount+1)` and `truncated := make([]uint32, 0, len(s.truncatedRows))`, writing `offsets[newRow+1] = uint32(cursor)` and `append(truncated, uint32(newRow))`. Drop the `encoding/binary` import. **Keep `truncated` explicitly non-nil** — the reason changes (a `(required)` FlatBuffers vector rather than `null` vs `""`) but the requirement does not.
3. **`internal/page/builder.go`** — drop the JSON struct tags on `TabularPage`/`DocumentPage`/`KeyValuePage`/`StreamPage` and the three "Kind is declared first so the emitted field order … matches" comments, which no longer describe anything. **Keep the JSON tags on `ColumnDescriptor` and `PagePosition`** — `ipcfixture/decode.go`'s `Logical*Page` structs embed both, and the six committed `tests/ipc/**/*.fixture.ts` corpora were captured against those exact tags.
4. **`internal/page/encode.go`** — new, §6.1.
5. **`internal/adapterhost/frame.go`** — new, §6.1.
6. **`internal/adapterhost/dataframe.go`** — `respond`/`respondError`/`respondPing`/`respondCacheStats`/`pushCacheStats` emit frames through `frame.go`. Delete `wireResponse`, `wireEvent`, `wireError` and the JSON-literal fallback. `handleDataOp`'s call sites are unchanged.
7. **`internal/adapterhost/session.go`** — correct `maxDataFrameBytes`'s comment (F6): the 1.33x base64 inflation it cites no longer exists.
8. Fix whatever `adapterhost/*_test.go` assertions read the JSON envelope; they should assert through the generated decoder, not by string matching.

**TypeScript**

9. **`packages/shared/protocol/frame.ts`** — new, §6.2.
10. **`frontend/src/bridge/port.ts`** — the five edits of §6.2, no others.
11. **`tests/ui/support/mockStream.ts`** — retarget C2's `buildResponsePayload` onto the generated builders: encode a complete `Frame` per snapshot with `builder.forceDefaults(true)` and `id = 0`, compute `idOffset` via `frame.bb_pos + bb.__offset(frame.bb_pos, ID_VTABLE_SLOT)`, and ship `{ base64, idOffset }`. Pre-encode also: the `ping` frame, each snapshot's `error` frame, and one `E_FIXTURE_MISS` frame **per `DATA_OP` value** so a miss still names its op.
12. **`tests/ui/support/mockStreamBrowser.js`** — the socket dispatches `new MessageEvent('message', { data: buf })` where `buf` is a fresh copy of the pre-encoded bytes (one per request, since ids differ) with `new DataView(buf).setInt32(idOffset, req.id, true)` applied. Add a 5-line `fromBase64` (`atob` + `charCodeAt`, mirroring the `toBase64` it is replacing). **No FlatBuffers knowledge in this file.**
13. **`tests/unit/support/wailsRuntime.ts`** — export and mock `Stream`, not `JSONStream`; update the module comment, which names `JSONStream` four times.
14. **`tests/unit/support/fakeSocket.ts`** — `__message(data: ArrayBuffer)`; `sent` now holds the JSON strings `port.ts` produced (it already documented both cases). Add `binaryType`.
15. **`apps/kira-studio/tests/support/encodeFrame.ts`** — new directory, one file: the frame encoder shared by `mockStream.ts` and `bridge-port.spec.ts`. Add `"../support/**/*.ts"` to `tests/unit/tsconfig.json`'s `include` and `"tests/support/**/*.ts"` to `apps/kira-studio/tsconfig.tests.json`'s.
16. **`tests/unit/bridge-port.spec.ts`** — rewrite. Tests 1-5 and 10 keep their rules (send gated on open; two requests correlate by id; an error frame rejects with its code; `timeoutMs`/`null`; event fan-out and unsubscribe; close rejects every pending) but carry real payloads encoded through #15. **Delete tests 6 and 7** — they test `decodeBase64`'s two paths, and `decodeBase64` no longer exists; the chunk-revival property they covered is now structural (a view over the frame) and is proved by §8.3. **Keep tests 8 and 9, rewritten** against a corrupt frame (a wrong file identifier is the cheapest deterministic corruption): a bad frame must reject the pending request rather than hang, and a bad *event* payload must drop just that event. Those are the P2 R2 rules and they still earn their keep.

**Verify:** §8.1, then **§8.3 in full** (the correctness gate), then §8.2 — including the mandatory `tests/e2e-real` run.

### C4 — `docs(perf): the P11 FlatBuffers data-plane measurements`

A new `docs/PERF.md` **§2.7**, immediately after §2.6, in §2.5/§2.6's established format: status line,
method paragraph, tables, then a plain-language paragraph on what remains. Content per §8.4.

**Verify:** §8.1, plus §9's greps.

### C5 — `docs: the data plane is FlatBuffers now, superseding P4's deferred binary envelope`

1. **`docs/ARCHITECTURE.md`**, Process model:
   - `:594` diagram and `:626-628` prose — `port.ts` opens `Stream('engine')`, not `JSONStream`, and the frames are binary FlatBuffers, not JSON.
   - `:630` — keep the "not a WebSocket on the build that ships" paragraph; only the `JSONStream`/`Stream` naming needs touching.
   - `:642-654` — the sentences *"its response `json.Marshal`ed directly with every chunk's four buffers base64-of-exact-LE-bytes (P58 D5)"*, *"There is no other wire shape any more"* and the `reviveChunks`/`toTypedArray` claim are all now wrong. Replace with: one FlatBuffers `Frame` per response, `"KIF1"` file identifier, `[uint]` offset/truncated vectors decoded as zero-copy views, requests still JSON (D3).
   - `:682-721` — rewrite the "FE↔BE protocol decision (P4)" block. Keep P4's still-true conclusions (gRPC declined; the network-split answer is `-tags server` plus F9's three local-machine semantics; the control plane keeps its bindings) and replace bullets 1 and 4 with P11's: FlatBuffers adopted, why Arrow's schema-per-frame tax and 51.4 KB bundle lost to a schemaless 2.7 KB one, and the fact that P4's own §5 envelope is superseded rather than deferred. Point at `docs/v1.1/plans/P11-flatbuffers-data-plane.md`.
   - `:746-754` — the closing paragraph ends *"it is what every kind uses today, not an aspiration."* base64 is no longer what any kind uses; keep §2.5's historical Node-vs-Go comparison, retire the present tense.
   - Grep the Caching section for any byte-size claim that implies wire bytes; L2 budgets in-memory bytes and always did (D9).
2. **`README.md:203`** — *"bulk result pages travel over a dedicated `JSONStream` data plane"* → a binary FlatBuffers data plane.
3. **`docs/v1.1/SPEC.md`** — add the P11 row to the phasing table, per that file's own *"keeps accruing rows as new phases land"* rule.
4. **`docs/v1/plans/p58-pending-ci-workflows/README.md`** — one line noting that whenever those staged workflows are applied (`AGENTS.md`'s Known open item / task #17) they need no `flatc` step, because generated code is committed (D11) — but that a schema change requires `bun run generate:wire` locally and a clean `git status` afterwards.
5. **`AGENTS.md` is not touched.** Its one Known-open-item is unaffected, and its own rule sends phase findings to the phase plan, which is this file.
6. **`docs/v1.1/plans/P4-...md` is not touched** (D13).

**Verify:** §8.1, plus §9.

---

## 8. Verification

### 8.1 After every commit

```sh
bun run lint
bun run typecheck
bun run build
go build ./apps/kira-studio/... && go vet ./apps/kira-studio/...
go test ./apps/kira-studio/internal/...
git status --porcelain          # must be empty
```

`go build ./...` additionally compiles the root `main` package, which imports Wails and needs the
GTK4/WebKitGTK headers on Linux (`AGENTS.md`). Use the narrow form for the loop.

### 8.2 Once, for C3

```sh
bun run test:unit
bun run test:ui                 # needs `bunx playwright install webkit` + its system libs
bun run test:ipc:fe
go test ./...                   # container-backed cases self-skip without Docker
node node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts --project=e2e-real
```

The last one is **not optional for C3**: `tests/e2e-real/sqlite-real.spec.ts` is the only place in
the repository where the real Go encoder meets the real `port.ts` decoder (F10), it runs
unconditionally and Docker-free here, and per `AGENTS.md` it must be launched through plain Node's
Playwright CLI, never `bunx`. It covers `TabularPage` only — which is why §8.3 exists.

Also once, for C1 and again at the end of C3:

```sh
bun run generate:wire && git status --porcelain   # must be empty (D11's drift gate)
```

### 8.3 The logical-equality proof — C3's actual correctness claim

This is a deliberate wire-format break, so P4's byte-identity technique does not apply. The claim to
prove is **logical equality**: the same cells, the same NULLs, the same truncation flags, the same
row order, the same scalar fields, across all four page kinds. Prove it directly, with throwaway
programs (not committed — the P58a M2 / `docs/PERF.md` §2.5 convention):

**Fixtures — the same eight P4 §8.3 enumerated, plus one this format adds:**

1. `TabularPage`, several columns, mixed NULL and non-NULL, several rows.
2. `DocumentPage`.
3. `KeyValuePage` — including `ttlMs`/`memoryBytes` both set and both `nil`, and a non-`hash` `redisType`.
4. `StreamPage` — including `visibilityTimeoutSeconds` set and `nil`.
5. An empty result set (`rowCount == 0`) for the tabular kind.
6. A NULL-only column.
7. A page with **several** truncated rows.
8. A page with **no** truncated rows at all — the empty-`(required)`-vector case (§5's note); this is the one that fails silently on the Go side and loudly on the user's.
9. **New:** a `PagePosition` with `offset == nil` and with `nextToken`/`prevToken` both `nil`, since optional scalars and absent strings are how this format expresses `null`.

**Method:**

- **At the pre-C3 commit**, build all nine through the real `internal/page` builders, marshal each through `dataframe.go`'s exact `respond` expression, and decode each through the *old* `port.ts` path (`JSON.parse` → `reviveChunks`) in a scratch script. Dump a canonical logical JSON per fixture: `{kind, rowCount, position, scalars…, columns…, cells: string|null per row per column, truncated: row indices per column}` — cells read through `isNull`/`cellText`, truncation through `isTruncated`. Record `sha256` of each dump.
- **After C3**, build the same nine the same way, encode through the new `EncodePage`/`encodeResponse`, decode through the *new* `packages/shared/protocol/frame.ts`, and dump in the same canonical shape. **Every hash must match.**
- Assert two further properties in the same program, because a hash match alone would not catch them:
  - **Zero-copy is real:** for at least one fixture, every decoded chunk's four typed arrays have the received frame's `ArrayBuffer` as their `.buffer` — not a fresh one. If any is a copy, D4's alignment choice or the object API has crept in (D15) and the entire decode win is gone.
  - **`byteSize` is unchanged** between the old and new encoders for all nine fixtures — this is D9's guard against `ChunkByteSize`'s `*4`s drifting, and it is what L2 budgets against.
- Additionally, in Go: `go test ./apps/kira-studio/internal/ipcfixture/...` in **read** mode must still match all six committed fixtures. F1 says it should be untouched by the format change; this is the check that it is.

If any hash differs, the difference is a semantic change and C3's premise is void — stop and
re-derive it rather than adjusting the decoder to match the encoder.

### 8.4 The measurement re-run for C4

Re-run P4 F10's four fixtures — `100 × 12`, `1 000 × 12`, `10 000 × 12`, `10 000 × 40`, 12 text
columns at 24 B cells (40 columns at 64 B for the wide case), 1 row in 97 NULL — on **this tree**,
through the **real schema** (not §2's untyped-builder approximation), and report:

| Column | What |
|---|---|
| Wire bytes, before → after | against `docs/PERF.md` §2.6's own before-numbers, so the table is directly comparable |
| Overhead vs raw buffer bytes | the honest replacement for §2.5's 1.334x |
| Go encode time and `TotalAlloc` delta, before → after | same instrument as §2.6, medians of enough in-process repetitions that the smallest fixture is steady |
| Frontend decode time, before → after | Bun/JavaScriptCore, with §2.6's own explicit "this is a proxy for WKWebView" caveat repeated |

State plainly what the FlatBuffers builder's own copy costs on the Go side (`CreateByteVector` is a
`memcpy` of `Data`; the `[uint]` vectors are a prepend loop) so the encode row is read as a real
figure rather than a free lunch, and note that D5 avoids a second whole-frame copy that a prefixed
header would have forced.

---

## 9. Acceptance checklist

P11 is done when every line below is true, checked against the tree rather than against this
document:

1. `grep -rn "reviveChunks\|toTypedArray\|decodeBase64\|fromBase64" apps/kira-studio/frontend/src packages/shared` returns **nothing**.
2. `grep -rn "JSONStream" apps/ packages/ --include='*.ts' --include='*.js'` returns **nothing** outside `node_modules` (`port.ts`, `tests/unit/support/wailsRuntime.ts` and their comments are all converted).
3. `grep -n "offsets:\[uint\]\|truncated:\[uint\]" packages/shared/protocol/page.fbs` matches — D4's zero-copy precondition is in the schema, not just in this plan.
4. `grep -n "len(chunk.Offsets)\*4" apps/kira-studio/internal/page/chunk.go` matches, and §8.3's `byteSize` assertion passed for all nine fixtures. `internal/enginecache/` has **no diff at all**.
5. `grep -rn "flatbuffers" apps/kira-studio/internal/adapters/` returns **nothing** — no adapter learned about the wire (D7).
6. `git diff --stat <pre-C3>..HEAD -- packages/shared/protocol/page.ts` is **empty** (D8), and so is the diff for `apps/kira-studio/frontend/src/bridge/data.ts` and `apps/kira-studio/frontend/src/views/`.
7. §8.3 has actually been run, all nine fixture hashes matched, and the zero-copy assertion passed. C3's commit message says so.
8. `bun run generate:wire && git status --porcelain` is empty — the committed generated code matches the schema, produced by the pinned `flatc 25.9.23` (D11).
9. `grep -rn "25.9.23" scripts/generate-wire.sh package.json go.mod` shows the same version in all three places, and the three SHA-256 digests in `scripts/generate-wire.sh` match §7 C1's table.
10. `go test ./apps/kira-studio/internal/...` is green, and `go test ./apps/kira-studio/internal/ipcfixture/...` in read mode still matches the six committed fixtures.
11. `bun run test:unit`, `bun run test:ui` and `bun run test:ipc:fe` are green, and `tests/e2e-real`'s sqlite project has been run and passed after C3 (§8.2), or has a **stated** reason it could not be.
12. `grep -c "flatbuffers\|FlatBuffers" apps/kira-studio/tests/ui/support/mockStreamBrowser.js` is **0** — the injected browser script has no FlatBuffers knowledge (D10), only a base64 decode and a `setInt32`.
13. `docs/PERF.md` contains a `### 2.7` section whose numbers were measured on this tree (§8.4), not copied from this plan.
14. `grep -n "base64" docs/ARCHITECTURE.md` has no match that describes the **current** data plane; the survivors are §2.5's historical Node-vs-Go comparison and the unrelated `kira:v2:<base64>` secrets envelope.
15. `docs/ARCHITECTURE.md` names the decision and points at `docs/v1.1/plans/P11-flatbuffers-data-plane.md`; `README.md:203` no longer says `JSONStream`; `docs/v1.1/SPEC.md` has a P11 row.
16. `git diff --stat <base>..HEAD -- docs/v1.1/plans/P4-fe-be-data-transfer-protocol.md` is **empty** (D13), and `NOTICES.md` is unchanged (D14).
17. `git status --porcelain` is clean and the diff contains no `.github/workflows/` file.

---

## 10. Open questions, handed forward

**OQ-1 — one frame retains every page it carried.** A zero-copy view keeps the whole received
`ArrayBuffer` alive as long as any chunk from it is alive. For `data:read` that is strictly better
than today (one buffer instead of N fresh typed arrays). For `data:execute`, which answers with
`pages[]`, holding one result page retains all of them. `views/console/resultPages.ts` holds a
statement batch's pages together anyway, so there is no *observed* leak — but this is a real change
in retention shape and P5 is the phase with the instrument. `tests/ui/perf.spec.ts` and
`leaks.spec.ts` assert on `byteSize`-derived numbers, which are unaffected (F8), so they will not
catch it either way. **Owner: P5 (RAM).**

**OQ-2 — three of the four page kinds still have no real-backend coverage.** F10: `tests/e2e-real/`
is SQL-only, so `DocumentPage`/`KeyValuePage`/`StreamPage` meet the real Go encoder and the real TS
decoder nowhere in the committed suites. §8.3 proves them once, during implementation, and then that
proof evaporates. This is P4 OQ-4, now overdue: the durable answer is a Docker-gated
`mongo-real`/`redis-real` spec in `tests/e2e-real/`, one page of each remaining kind. **Owner:
whoever next touches the wire, or P10's review round three.**

**OQ-3 — the request direction stays JSON, and one day that will look asymmetric.** D3 is right on
today's numbers (requests are ~200 B at interaction rates) and right on validation (`Validate()`
enforces constraints FlatBuffers cannot express). It stops being right if a request ever carries
bulk — a paste of 10 000 rows through `data:mutate` is the plausible case. **Owner: whoever adds a
bulk request payload; the schema already has the room.**

**OQ-4 — `flatc` has no official Linux arm64 release asset.** `scripts/generate-wire.sh` fails
loudly there with the `FLATC` override named (D12), which is correct but is a papercut for anyone
developing on Linux arm64. The escape hatches are a distro package pinned to 25.9.23 or a local
build. **Owner: the first person who hits it.**

**OQ-5 — P4's OQ-1, OQ-3 and OQ-5 are untouched and still open.** The network split is blocked on
three local-machine semantics plus the absence of any authentication in Wails' server mode;
`adapterhost.Session`'s 32 MiB queue still sits in front of Wails' 8 MiB one; the control plane's
bulk payloads (`TreeService.Children`, `Describe`, `Definition`) have still never been measured.
None of them is a serialization question and none is changed here. **Owner: as P4 assigned them.**

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/page/chunk.go` (and `builder.go`, `scratch.go`) — the codec being wrapped; `ChunkByteSize`'s `*4`s are the one silent-failure line
- `/home/user/kira-studio/apps/kira-studio/internal/adapterhost/dataframe.go` — `respond`/`respondError`/`pushCacheStats`, the entire Go-side encode boundary
- `/home/user/kira-studio/apps/kira-studio/frontend/src/bridge/port.ts` — the five-line transport switch and the deletion of the whole base64 path
- `/home/user/kira-studio/packages/shared/protocol/page.ts` — the types the decoder must reproduce exactly, and the four builders the test encoder reuses (this file itself is not edited)
- `/home/user/kira-studio/apps/kira-studio/tests/ui/support/mockStream.ts` and `mockStreamBrowser.js` — the third implementation, and the only place whose constraints (no imports, injected as text) dictate a design rather than follow one
