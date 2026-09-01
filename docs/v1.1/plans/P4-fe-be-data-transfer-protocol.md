# P4 — FE↔BE data transfer protocol

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P4 row): *"Analyze how the renderer
> and the Go backend exchange data today (the `adapterhost`/`bridge` streaming frame protocol) for
> both efficiency and scalability, with an explicit eye toward a future where the frontend and
> backend are split apart and communicate over a real network instead of Wails' in-process bridge.
> Weigh a standardized transport/serialization protocol (e.g. gRPC, HTTP/2+protobuf, or similar
> off-the-shelf options) against the current hand-built framing, and adopt one if it's a genuinely
> better fit rather than defaulting to keeping the hand-built approach. Produce a concrete
> recommendation (format, framing, and any transport-shape implications), and land whatever
> low-risk improvements the analysis turns up now."*
>
> **The recommendation, in one line: keep the two-plane shape and the hand-built JSON framing,
> reject gRPC/protobuf/Arrow for reasons that are specific to this app rather than generic, and land
> the one change the measurements actually justify — a Go-side encoder fix worth 6–12x that changes
> no byte on the wire** (§4, C1).
>
> **The most valuable finding is that the current frame's cost is not where two chapters of docs
> have assumed it is.** `docs/PERF.md` §2.5 measured base64's 1.334x wire inflation and treated that
> as the encoding's cost. It is not the dominant cost. `internal/page` implements
> `json.MarshalJSON` on all four page types *and* on `Uint32LE`, and every `json.Marshal`ed
> Marshaler is encoded into a throwaway buffer and then re-scanned byte-by-byte by
> `encoding/json`'s `compact`. Measured on the same fixture shape §2.5 used (F11): a default
> 100-row page costs **346 µs** to encode today and **47 µs** with those marshalers gone — for
> **byte-identical output**. A 10 000-row page: **38.3 ms → 4.5 ms**, allocations **12.7 MB →
> 4.5 MB**. That is a bigger win than switching the whole wire to binary would buy on the Go side
> (2.3 ms), and it costs no protocol change, no frontend change, and no fixture regeneration.
>
> **The network split is not blocked on the protocol, and choosing gRPC would not unblock it.**
> Wails v3 beta.15 already ships the network transport this phase was told to plan for: a
> `//go:build server` build serves the identical bound-call surface and the identical named streams
> over a real TCP listener, with streams as **real binary WebSockets** (`coder/websocket`,
> `websocket.MessageBinary`) selected by a runtime prelude the frontend never sees (F3). This repo
> already runs it — `tests/e2e-real/` is built on it. What actually blocks a split is semantic, not
> serialization: `FilesService.ChooseSave` opens a **native save dialog on the Go side** and hands
> the renderer a path that `data:objectDownload` then writes to on the Go side; secrets live in the
> Go side's OS keychain; `internal/preconnect` spawns local processes (F9). None of that is a wire
> format problem, and none of it gets easier under gRPC.
>
> **gRPC cannot run on the desktop transport at all.** The desktop data plane is not a WebSocket
> despite what `docs/ARCHITECTURE.md`'s diagram says — it is a held `GET /wails/stream/poll` plus a
> `POST /wails/stream/send`, served by the asset server *inside* the native process over a custom
> URI scheme, deliberately so that no local TCP port is open for any other process on the machine to
> reach (F2). gRPC needs HTTP/2 with trailers; a custom-scheme handler cannot provide it, and
> browsers cannot speak gRPC natively regardless. Adopting it means opening a local port — the exact
> thing Wails' own stream design says it exists to avoid — plus a second codegen system alongside
> the bindings generator that this repo already depends on for twelve services (F17, F21).
>
> **The closest off-the-shelf fit is not gRPC, it is Arrow — and it is still declined.**
> `page.Chunk` is, field for field, Arrow's `Utf8` array layout: validity bitmap + `int32`-width
> offsets + packed UTF-8 values (F19). Adopting Arrow IPC would be a real option rather than a
> stretch. It is declined on three specific mismatches (inverted validity polarity, a `truncated`
> buffer Arrow has no slot for, and four page kinds of which only one is tabular) plus a bundle-size
> cost that lands squarely on P5's RAM goals — not on "we already have something."

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `4dd3cc2` (the last P3 commit), with every finding below checked against source
read in this container or against a measurement run in it — never against an earlier plan's prose,
per `docs/v1.1/README.md`'s standing rule.

| Claim | Evidence |
|---|---|
| P3 landed | `apps/` + `packages/` exist, no `shell/` or `src/`; `go.mod:1` is `module github.com/kirathecat/kira-studio` |
| Tracked tree clean at authoring time | `git status --porcelain` → empty |
| Go tiers green at baseline | `go test ./apps/kira-studio/internal/adapterhost/... ./apps/kira-studio/internal/page/... ./apps/kira-studio/internal/enginecache/...` → `ok`, `ok`, and **`internal/page` reports `[no test files]`** (F16) |
| Wails source read, not guessed | `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/` — `pkg/application/stream.go`, `stream_transport.go`, `stream_session.go`, `stream_server.go`, `stream_prelude_{desktop,server}.go`, `application_server.go`, `application_options.go`, `transport_http.go`, and `internal/assetserver/bundledassets/runtime.debug.js`. `v3.wails.io` is 403-blocked from every box here (`AGENTS.md`), so the pinned module *is* the documentation |
| Data-plane surface | 8 data ops (`data:{read,count,invalidate,preview,mutate,execute,objectDownload}` + the three local ops `ping`/`cache:stats`/`cache:clear`), 4 page kinds, 12 bound control services |
| Measurements are reproducible and were run here | §2's method, fixture and programs are described in F10; nothing was committed to the repo (the P58a M2 convention `docs/PERF.md` §2.5 records) |

**Measurement provenance, stated once.** All §2 numbers come from throwaway programs in this
session's scratch directory, built on a **verbatim copy** of `apps/kira-studio/internal/page`'s
`chunk.go` and `builder.go` (the same technique, and the same wording, `docs/PERF.md` §2.5 used for
P58a M2 — `internal/` cannot be imported from outside the module, so a copy is the only way to
measure the real codec from a scratch module). Go side: Go 1.25.0, Linux x64 container. Frontend
side: **Bun 1.4.0**, whose engine is JavaScriptCore — the same engine family as the WKWebView this
app actually ships on, which is why it is a defensible proxy, but it is a proxy and is labelled as
one everywhere it appears.

### 0.2 Scope

1. Read the whole current protocol on both sides and both planes, including the Wails layer
   underneath it, and state what it actually is (§1).
2. Measure it — encode cost, wire size, decode cost — rather than reasoning about it (§2).
3. Weigh the off-the-shelf alternatives against those measurements (§3).
4. Produce the concrete recommendation the SPEC row asks for: format, framing, transport-shape
   implications (§4), with the successor format fully specified so that adopting it later is a
   build and not a re-analysis (§5).
5. Land the low-risk improvements the analysis turns up (§7), and record the measurements and the
   decision where this repo keeps such things — `docs/PERF.md` and `docs/ARCHITECTURE.md`.

### 0.3 Not in this phase

- **Any change to the wire format.** C1 is byte-identical by construction and is verified as such
  (§8.3). The binary envelope is specified in §5 and deliberately not built (D5).
- **Any new dependency.** No gRPC, protobuf, Arrow, msgpack or FlatBuffers library is added on
  either side (D2, D3, D4).
- **Any actual network split.** F9 shows the split is blocked on semantics this phase does not
  touch. §10 OQ-1 carries it forward with the specific list.
- **Retuning `adapterhost.Session`'s queue bounds.** F15 finds the app's own 32 MiB budget sitting
  in front of Wails' 8 MiB one; that is a RAM question with no measurement behind it yet, and P5 is
  the phase that owns it (D8, OQ-3).
- **Anything on the control plane.** Twelve bound services keep the Wails-generated bindings
  exactly as they are (D1).
- `.github/workflows/*.yml` — same `workflow`-scope constraint P1 D10 and P3 D15 recorded; nothing
  in this phase touches them anyway.

### 0.4 Ground rules

- **Every decision in §6 cites a finding, and every finding cites something read or run.** Where a
  claim could not be verified here, the finding says so and names what would verify it (F13's
  JavaScriptCore-not-WKWebView caveat; F3's server-mode claim, verified by reading the source and by
  the existence of `tests/e2e-real/`, not by running a split deployment).
- `AGENTS.md`'s standing rules apply: no stubs, no dual-format compatibility paths, comments only
  where the code cannot speak for itself, Conventional Commits.
- **No new unit test is added by this phase.** C1 is a change whose entire correctness claim is
  "the bytes are identical", and the cheapest honest proof of that is a byte-for-byte comparison
  run during implementation (§8.3) plus `tests/e2e-real/`, which is the *only* place in the
  repository where the real Go encoder meets the real frontend decoder (F16). A serialize-then-
  deserialize unit test is explicitly listed in `AGENTS.md` as not clearing the bar, and would
  prove less than the check §8.3 specifies.
- **This phase's commit sequence is short, and that is the correct shape, not an under-delivery.**
  The SPEC row's deliverable is an analysis plus a recommendation plus whatever low-risk work falls
  out. One code commit falls out. §4 says plainly what was considered and rejected, so the
  smallness is a result rather than an omission.

---

## 1. Findings — what the protocol actually is

### F1 — The two planes, traced end to end

**Control plane.** `apps/kira-studio/frontend/src/bridge/control.ts` calls the generated bindings
(`@bindings/*.js`), which call `$Call.ByName("…")` from `/wails/runtime.js`. That resolves to a
`POST` against `/wails/runtime` handled by `pkg/application/transport_http.go`'s
`processBody`/`handleRuntimeRequest`, dispatched through `MessageProcessor` to one of twelve bound
services under `apps/kira-studio/internal/bridge/`. Request and response are both plain JSON;
oversized request bodies are chunked by the runtime and reassembled by `handleChunkedRequest`.
Errors come back as `ipcerr.Error`'s JSON, unwrapped exactly once by `control.ts`'s `unwrap()`.

**Data plane.** `apps/kira-studio/frontend/src/bridge/port.ts:30` opens `JSONStream('engine')` once
per page load. `apps/kira-studio/internal/shell/app.go:84` registers the handler; `bridge/stream.go`
(`StreamName = "engine"`, `ServeEngineStream`) loops on `conn.Receive()` and hands each frame to
`adapterhost.Router.HandleDataFrameAsync`. Frames are JSON objects of three shapes, declared in
`adapterhost/dataframe.go:21-38` and mirrored in `packages/shared/protocol/port.ts`:

```
{kind:"req", id, op, payload}          renderer → Go
{kind:"res", id, ok, payload|error}    Go → renderer, correlated by id
{kind:"evt", topic, payload}           Go → renderer, unsolicited (only cache:stats today)
```

`HandleDataFrame` parses just the envelope (`Payload json.RawMessage`), switches on `op`, and for
the five adapter-backed ops decodes-and-validates the payload into one of `wire.go`'s eight
`*RequestWire` structs — each with an explicit `Validate()`, because "a naive `json.Unmarshal` is
not a substitute for zod's `safeParse`" (`wire.go:10-14`).

**Bulk payloads are columnar.** `page.Chunk` (`internal/page/chunk.go:77-82`) is three exactly-sized
buffers plus a truncation list: `Data []byte` (packed UTF-8), `Offsets` (`rowCount+1` uint32),
`Nulls` (a `1 = NULL` bitset), `Truncated` (sorted row indices). All four cross the wire as base64
of their exact little-endian bytes (P58 D5) — `[]byte` gets that from `encoding/json` for free, and
`Uint32LE` (`chunk.go:36-44`) exists solely to give the two uint32 buffers the same treatment.
`port.ts`'s `reviveChunks`/`toTypedArray` (`:99-122`) is the only decoder, recognising a chunk by
its four field names because all four page kinds reuse the identical chunk shape under different
names (`packages/shared/protocol/page.ts:47-53`, and `:113-160` for the other three kinds).

### F2 — The desktop data plane is not a WebSocket. `docs/ARCHITECTURE.md`'s diagram says it is

Read from `pkg/application/stream_transport.go:16-72`. On a desktop build the transport is two
endpoints on the asset server the app already serves:

```
GET  /wails/stream/poll   held open up to streamHoldTimeout (20 s) until there is something to deliver
POST /wails/stream/send   one frame (or a batch) from the frontend
```

Control data travels in headers (`x-wails-stream-{session,generation,conn,kind,name,chunk*,batch}`)
because "WebKitGTK 6.0 can deliver POST bodies as query params for custom URI schemes … and
WebView2 caps body delivery around 2 MB". The poll response body is a binary frame format of its
own — `streamMagic` `"WS1\0"`, then `count u32`, then per frame `connID u32 | kind u8 | len u32 |
payload` (`:69-77`, and the frontend's `decodeFrames` at `runtime.debug.js:3806`, which hands each
payload to a connection as an **`ArrayBuffer`**).

`pkg/application/stream.go`'s own package comment states the reason plainly: *"A WebSocket cannot be
spoken over a custom URL scheme, so the only way to get one in a webview today is a real listener …
which means an open local port reachable by any other process on the machine."* That is a security
posture this app inherits for free, and any protocol proposal that needs a socket gives it up
(F17).

`WailsSocket` emulates the `WebSocket` interface over that pair — `readyState`, `onmessage`,
`bufferedAmount`, `send()` serialised per connection through a promise chain — which is why the
frontend code reads as if it were a socket. **`docs/ARCHITECTURE.md`'s Process model diagram calls
it "one 'engine' WebSocket stream" and its prose calls it "a single named stream".** The prose is
fine; the diagram's word "WebSocket" is only true of a `-tags server` build (F3). C3 fixes it.

### F3 — Wails already ships the network transport, and this repo already runs it

`pkg/application/stream_prelude_server.go` (build tag `server`) prepends a factory to the runtime
bundle:

```js
window._wails.streamFactory = function(name) {
  var p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var sock = new WebSocket(p + '//' + location.host + '/wails/stream/ws?name=' + encodeURIComponent(name));
  sock.binaryType = 'arraybuffer';
  return sock;
};
```

`Stream(name)` (`runtime.debug.js:3466`) prefers that factory when present and falls back to
`WailsSocket` otherwise. `stream_server.go`'s comment states the consequence: *"Only the sink
differs — the handler, StreamConn, and the application code above them are identical to the desktop
build."* Frames are written as `websocket.MessageBinary` (`stream_server.go:162`). Bound calls in
server mode go over the same asset server, now on a real `net.Listener` (`application_server.go`).
`ServerOptions` (`application_options.go`) carries `Host`, `Port`, `TLS`, and WebSocket origin
controls.

So: **the "split the frontend and backend over a real network" scenario has an existing,
first-class answer in the framework, requiring zero application changes and zero frontend
changes** — and `apps/kira-studio/tests/e2e-real/` is already built on exactly that build tag
(`AGENTS.md`'s Wails section: *"it serves the whole bound-call surface and the data-plane stream
over a real TCP listener with no webview"*).

**What it does not carry, stated so the next session does not over-read this finding:**
`ServerOptions` has TLS and origin patterns but **no authentication or authorization of any kind**.
A real remote split needs an identity layer Wails does not provide. That is a bigger open problem
than serialization, and it is not one gRPC would solve either (gRPC's auth story is also
"bring your own").

### F4 — The application is already transport-agnostic, and the seam is two interfaces wide

`bridge.StreamSession` and `adapterhost.StreamSession` are each declared as exactly:

```go
type StreamSession interface {
    Send(frame []byte) error
    Receive() ([]byte, error)
}
```

Two independent declarations, satisfied structurally by `*application.StreamConn` (A11's
per-consumer-interface discipline; neither package imports Wails). Everything above that seam —
routing, validation, dispatch, the op scheduler, the caches — deals in `[]byte` frames and never
learns whether those bytes travelled over a held poll, a WebSocket, or a pipe.

This is the structural fact that decides §4. **The encoding choice is isolated behind exactly two
functions** — `json.Marshal` in `dataframe.go`'s `respond`, and `reviveChunks` in `port.ts` —
neither of which any other part of the app can see. Deferring the encoding decision therefore
forecloses nothing: it is a localised change whenever it is made, not a migration.

### F5 — Backpressure is three layers deep and already designed, not accidental

| Layer | Bound | Behaviour when full |
|---|---|---|
| `adapterhost.Session` (`session.go:26-44`) | 64 frames / 32 MiB queue; `sessionMaxInFlightOps` 64 concurrent frame goroutines; `maxDataFrameBytes` 64 MiB | `enqueueResponse` **blocks** for room (a dropped response could never settle its pending request — P2 R1); `enqueueLocal` **drops** an event (the next `cache:stats` supersedes it) |
| Wails per-session outbound (`stream.go:56-70`) | 8 MiB / 256 frames per window; 256 MiB / 4096 frames application-wide | `Send` blocks, `TrySend` returns `ErrStreamFull`; one frame is always admitted whole even if it exceeds the byte budget (`stream_session.go:150`) |
| Wails inbound (`stream.go:117-129`) | 256 frames / 8 MiB | endpoint answers **429** and the client retries the same frame — deliberately not blocking, because "the held request is this transport's scarce resource" |

Two properties worth recording because they bear on §3: a **single frame is never split across poll
responses** (`stream_session.go:279`'s `n > 0 &&` guarantees the first frame goes whole, whatever
its size), and `streamMaxResponseBytes` (1 MiB) therefore batches *small* frames rather than
chunking large ones. And the app's own `respond` refuses a payload over `maxDataFrameBytes - 4096`
with a visible error rather than queueing a frame that could never be delivered
(`dataframe.go:217-239`).

### F6 — What actually crosses the wire, and how often

- **Default page size is 100 rows** (`internal/storage/model/settings.go:40`), from a validated set
  of `{10, 100, 1000, 10000}` (`packages/shared/domain/settings.ts:18`). The 10 000-row page is an
  opt-in extreme; it is also, per `docs/PERF.md`'s L2 note, large enough that a single page can
  exceed half the cache budget and never be cached at all.
- **Traffic is human-paced**: a page load per scroll-to-next-page, per tab switch that misses the
  renderer's own two-level page cache, per refresh. There is no subscription, no tail, no polling
  data source in the product. The one unsolicited server-push topic is `cache:stats`.
- **The bulk ops are `data:read` and `data:execute`.** `data:count`, `data:mutate`,
  `data:preview`, `data:invalidate` and `data:objectDownload` all answer with a handful of fields;
  `objectDownload` streams to a local file and returns a byte count, never the bytes.
- **The control plane also carries bulk**, and it is easy to miss: `TreeService.Children` returns
  every node of an expanded level, and `Describe`/`Definition` return whole object metadata. These
  are ordinary JSON over the bound-call transport, cached in `internal/tree`'s cache-aside as
  marshalled JSON (`tree/service.go:123,153,181`).

That volume profile is the single most important input to §3. This is a desktop GUI moving grid
pages at interaction rates — not an OLAP scan pipe.

### F7 — Three implementations of the wire encoding exist, in two languages

1. **Go encoder** — `internal/page`'s four `MarshalJSON` methods (`builder.go:91,190,253,326`) plus
   `Uint32LE.MarshalJSON` (`chunk.go:38`).
2. **TypeScript decoder** — `port.ts`'s `reviveChunks`/`toTypedArray`/`decodeBase64` (`:90-122`).
3. **A second encoder, in JavaScript** — `apps/kira-studio/tests/ui/support/mockStreamBrowser.js:76`'s
   `encodeChunk`, which builds base64 chunk payloads from logical rows so the `tests/ui` and
   `tests/ipc` frontend tiers can drive `port.ts` without a Go process.

Any wire-format change is therefore a three-place change, and #3 is the one a plan would forget.
This is a real part of the cost side of §3's ledger.

**What is *not* affected by a format change, checked rather than assumed:** the six committed
`tests/ipc/<adapter>/*.fixture.ts` corpora store **logical** pages, not encoded chunks —
`ipcfixture/harness.go:246-262`'s `DataRead` calls `DecodePage(resp.Page)` and records the decoded
form. So neither C1 nor any future format change invalidates the fixture corpus or requires the
Docker-backed regeneration run.

### F8 — The binary channel is already available, with no Wails change and no new dependency

`JSONStream(name)` (`runtime.debug.js:3489`) is a thin wrapper over `Stream(name)`: it replaces the
socket's `_decode` with `JSON.parse(TextDecoder.decode(payload))` and wraps `send` with
`JSON.stringify` (`:3547-3548`). Underneath, `WailsSocket.binaryType` is `"arraybuffer"` by default
(`:3313`) and inbound payloads arrive as `ArrayBuffer` slices (`:3806`); `send()` accepts strings,
`ArrayBuffer`, any `ArrayBufferView`, or a `Blob` (`toBytesSync`/`toBytes`, `:3551-3591`). Go's
`StreamConn.Send([]byte)` was always byte-oriented.

**So "go binary" is not blocked by anything, on either transport** — it is one line
(`Stream('engine')` instead of `JSONStream('engine')`) plus the app doing its own encode/decode.
That is what makes §5's specification cheap to write and cheap to adopt later, and it removes
"the framework won't let us" from the list of reasons to keep JSON. The reason to keep JSON has to
be, and in §4 is, a measurement.

### F9 — The split is blocked on semantics, not on the protocol

Three flows assume "the Go side's machine" and "the user's machine" are the same machine:

- **File save.** `FilesService.ChooseSave` (`bridge/files.go:60`) opens a **native save dialog on
  the Go side** and returns a path string; the renderer passes that path back as
  `ObjectDownloadRequestWire.DestPath`, and `adapters/s3/adapter.go:193`'s `downloadObject` writes
  the object to it — on the Go side's filesystem. Split the two and this flow silently writes to
  the wrong machine.
- **Secrets.** `internal/secrets` is the OS keychain of whatever machine the Go side runs on
  (`AGENTS.md`'s secrets section). A remote backend holding every user's database passwords in one
  keychain is a different product decision, not a port.
- **Pre-connect.** `internal/preconnect` supervises locally spawned processes (SSH tunnels and the
  like) with process-group kills.

None of these is a serialization problem, and adopting gRPC today would leave all three exactly
where they are. This is the honest scoping answer to the SPEC row's forward-looking clause:
**P4 is about choosing a protocol shape that would not need a rewrite if a split ever happened, not
about enabling one** — and F4 shows the current shape already satisfies that.

---

## 2. Findings — the measured cost of the current encoding

### F10 — Method and fixture

Four fixtures, built through a verbatim copy of the real `page` codec (§0.1), covering the
configurable page sizes plus a deliberate worst case:

| Fixture | Shape | Raw buffer bytes (`PageByteSize`) |
|---|---|---|
| `100 × 12` | default page size, 12 text columns, 24 B cells | 34,308 |
| `1 000 × 12` | | 335,460 |
| `10 000 × 12` | max page size | 3,346,176 |
| `10 000 × 40` | wide worst case, 64 B cells | 26,987,520 |

1 row in 97 NULL, matching §2.5's own fixture convention. The timed unit is the **real production
call**: `json.Marshal(wireResponse{Kind:"res", ID, OK:true, Payload: ReadResponse{Page, Source}})` —
i.e. `dataframe.go:229`'s exact expression, not a bare chunk. Allocation is
`runtime.MemStats.TotalAlloc` delta per call, the same instrument §2.5 used. Medians of three runs;
where a number was noisy across runs, the range is given rather than the median alone.

A second fixture set with **per-cell distinct pseudo-random content** was built for the compression
comparison in F12, because the fixed-value fixture is unrealistically compressible and would have
made base64 look better than it is.

### F11 — The Go encode cost is dominated by `encoding/json`'s Marshaler nesting, not by base64

`encoding/json` handles a `json.Marshaler` by calling it, then **`compact`ing the returned bytes
byte-by-byte** into the output buffer. This codec crosses that boundary twice on every page: once
for the page (`TabularPage.MarshalJSON` etc., which itself calls `json.Marshal` on an anonymous
struct), and once per uint32 buffer (`Uint32LE.MarshalJSON`, which calls `json.Marshal` on a
freshly allocated `[]byte`) — 24 of them for a 12-column page.

| Fixture | Wire bytes | **Today** | **No page Marshaler, `Uint32LE` kept** | **No custom Marshaler at all** |
|---|---|---|---|---|
| 100 × 12 | 46,616 | 346 µs / 112 KB | 88 µs / 64 KB | **47 µs / 49 KB** |
| 1 000 × 12 | 448,139 | 3.72 ms / 1.18 MB | 1.15 ms / 741 KB | **0.47 ms / 451 KB** |
| 10 000 × 12 | 4,462,430 | 38.3 ms / 12.7 MB | 13.1 ms / 7.3 MB | **4.5 ms / 4.47 MB** |
| 10 000 × 40 | 35,985,583 | 316–354 ms / 106–136 MB | 67.6 ms / 62.7 MB | **30–136 ms / 36.0 MB** |

Read the table three ways:

1. **The output is byte-identical in all three columns** — asserted in the measurement program
   itself (`bytes.Equal(json.Marshal(p), json.Marshal(plain))` → `true` for every fixture). This is
   not a format change; it is the same format encoded without the round trips.
2. **Both boundaries have to go.** Removing only the page-level Marshaler buys roughly half.
3. **Allocation is the stable, un-noisy result**: today's encoder allocates **2.3×–3.8× the size of
   the frame it produces**; without the Marshalers it allocates **1.00×** (35,987,888 B allocated
   for a 35,985,583 B frame — one buffer, no intermediate copies). Wall-clock at the 36 MB fixture
   swings run to run with GC; the allocation ratio does not.

For comparison, the binary envelope of §5 encodes the same fixtures in **31–44 µs / 0.18 ms /
2.3–2.5 ms / 13.2–13.8 ms**. So of the total Go-side gap between today and a full binary rewrite,
**the Marshaler fix closes roughly 85–90%** and requires no protocol change at all.

### F12 — Wire size: base64 costs 33%, and compression does not give it back

| Fixture (varied-content set) | JSON+base64 | Binary envelope | Ratio | gzip -6 JSON | gzip -6 binary | Compressed ratio |
|---|---|---|---|---|---|---|
| 100 × 12 | 46,604 | 36,404 | 0.78 | 26,622 | 20,084 | 0.75 |
| 1 000 × 12 | 448,127 | 337,644 | 0.75 | 290,271 | 196,196 | 0.68 |
| 10 000 × 12 | 4,462,418 | 3,348,432 | 0.75 | 2,838,962 | 2,117,659 | 0.75 |

`docs/PERF.md` §2.5's 1.334x reproduces exactly (the envelope adds a further ~2% at the smallest
page, where column descriptors and position are a larger share). **The finding that is new here is
the compressed column**: a plausible "the network case will compress it away" argument does *not*
hold — base64's inflation survives gzip at roughly the same ratio, because it is a fixed 4:3
alphabet expansion of already-high-entropy bytes rather than redundancy a compressor can find.
(On the *fixed-content* fixture the compressed numbers are wildly different in both directions;
that fixture is unrepresentative and its compression numbers are deliberately not quoted.)

### F13 — Frontend decode is O(frame) today and O(columns) under a binary envelope

Decode cost, measured under Bun 1.4.0 / JavaScriptCore (§0.1's proxy caveat applies), warm, on the
frames the Go program actually emitted. "Today" is `TextDecoder.decode` → `JSON.parse` →
`reviveChunks` with `Uint8Array.fromBase64` — i.e. exactly `port.ts`'s path including the P2 R1
native-base64 fast path. "Binary" is `JSON.parse` of the small header plus typed-array **views**
over the payload.

| Fixture | Today | Binary envelope |
|---|---|---|
| 100 × 12 | 0.23 ms | 0.030 ms |
| 1 000 × 12 | 0.96 ms (1.24 ms varied content) | 0.026 ms |
| 10 000 × 12 | 3.4 ms (4.3 ms varied content) | 0.016 ms |
| 10 000 × 40 | 35–38 ms | 0.06–0.14 ms |

The binary column is near-constant because it copies nothing: the payload bytes are never touched
at decode time, only when the grid reads a cell — which it does in both designs. The honest framing
is not "500x faster"; it is **"the whole-frame decode pass disappears"**. Today's path materialises
every buffer of every column into a fresh typed array before the first cell is read, on the
webview's main thread, inside the interaction the user is waiting on (`docs/PERF.md` §1's tab
switch and page-load budgets are 50 ms p95).

**One design constraint fell out of building the measurement, and it is the kind of thing a plan
should record rather than let an implementer rediscover:** a zero-copy `Uint32Array` view requires
its byte offset within the `ArrayBuffer` to be a multiple of 4. The first draft of the envelope
threw `RangeError: byteOffset modulo TypedArray.BYTES_PER_ELEMENT must be 0`. §5's framing
therefore pads the header and every uint32 section to a 4-byte boundary; without that, a binary
envelope silently becomes a copying envelope and loses most of this table.

### F14 — Encode cost is paid per page *view*, not per query

`Dispatcher.Read` (`data.go:48-87`) serves an L2 cache hit by returning the cached `page.Page` —
and `respond` then marshals it again, in full. There is no encoded-frame cache. So F11's numbers are
the cost of *every* page delivery that misses the renderer's own two-level cache
(`views/shared/page/store.ts`), including every server-side cache hit. Paging back and forth across
a 10 000-row table re-encodes 4.5 MB per step today.

Caching encoded frames alongside decoded pages was considered and is declined (D7): it would roughly
double L2's memory for the same budget accounting, on a phase whose successor is P5 (RAM), to save
work that C1 already reduces by 8x.

### F15 — Peak transient memory on the big-page path, and a bound sitting in front of a smaller bound

For the 36 MB fixture the retained set during one delivery is: the built `page.Page` (27 MB of
buffers) + the marshalled frame (36 MB) + today's encoder overhead (106–136 MB of transient
allocation) + Wails' own `encodeStreamFrames` copy into a pooled response buffer + the platform
response buffer. C1 removes the third term entirely (F11: allocation drops to 1.00× the frame).

Separately: `adapterhost.Session`'s queue budget is **32 MiB** (`session.go:31`) sitting directly in
front of Wails' own per-window outbound budget of **8 MiB** (`stream.go:59`). The app-level budget
therefore rarely binds — the producer can run 32 MiB ahead of a pipe that will only buffer 8 MiB —
and the difference is retained bytes. Also worth recording, since A18's rationale is stated in
`session.go:46-50` as "a blocking `conn.Send` called from two goroutines directly would be a data
race": in this Wails version `Send` is mutex-protected and explicitly documented as safe from any
goroutine, with a single drainer preserving order (`stream.go`'s package comment,
`stream_session.go:121-212`). The single-writer goroutine is therefore not *required* for safety
here — though it still owns the session context and the in-flight semaphore, which are. Both
observations are handed to P5 (OQ-3), not acted on (D8).

### F16 — `internal/page` has no tests, and the real encoder meets the real decoder in exactly one place

`go test ./apps/kira-studio/internal/page/...` reports `[no test files]`. The encoder is covered
only indirectly:

| Tier | What it actually exercises |
|---|---|
| `adapterhost/*_test.go` | the frame envelope and the session queue, with trivial payloads |
| `internal/ipcfixture` | the Go codec's *decode* accessors (`page.IsNull`/`page.CellText`) — it records logical pages, so the JSON chunk encoding never reaches the fixture (F7) |
| `tests/ui`, `tests/ipc` frontend halves | `port.ts`'s decoder against `mockStreamBrowser.js`'s **JS** encoder — never against Go's |
| **`tests/e2e-real/sqlite-real.spec.ts`** | **the real `-tags server` binary's real Go encoder against the real `port.ts` decoder in a real browser tab** — and per `AGENTS.md` it runs unconditionally here, Docker-free |

That table is why §8.3 makes `tests/e2e-real` a required gate for C1 rather than an optional extra,
and why the byte-identity check is done directly rather than trusted to the suites.

---

## 3. The off-the-shelf options, weighed

Each option is judged against the same five axes: does it work on the desktop transport at all;
what it does to wire size and CPU against §2's measurements; what it costs in schema/codegen; what
it does to backpressure; and what it costs to migrate given F7's three implementations.

### F17 — gRPC

**Cannot run on the desktop transport.** gRPC requires HTTP/2 with trailers over a real socket. The
desktop plane is a custom-URI-scheme handler intercepted inside the native process
(`AGENTS.md`: *"`pkg/application/linux_cgo.go` registers `wails://` as a custom URI scheme
intercepted inside the native process, so `curl` or a plain browser tab can never exercise real
bindings there"*), and browsers cannot originate gRPC regardless — the browser answer is gRPC-Web,
which needs a translating proxy or an Envoy-class sidecar in front of the backend.

Adopting it therefore means: open a local TCP port (giving up precisely the property
`pkg/application/stream.go`'s design comment says the stream transport exists to preserve), run a
gRPC server next to Wails' asset server, keep Wails' bindings for everything that stays bound
(window, dialogs, menus, events — none of which have gRPC equivalents), and add gRPC-Web plumbing
in the renderer. The result is *two* transports, not one, on the platform the product actually
ships on.

**On the axes it would win**, it does not: streaming flow control (HTTP/2 windows) would replace the
three already-designed layers of F5 with something less specific; and the wire-size win is
protobuf's, not gRPC's, and is available without gRPC (F18).

### F18 — protobuf (or FlatBuffers/Cap'n Proto) as the serialization, over the existing stream

This is the fair version of the "adopt a standard" proposal: keep Wails' transport, replace JSON
with protobuf messages carried as binary frames (F8 shows the frames can be binary today).

- **Wire size**: a page's bulk is four opaque buffers. In protobuf they are `bytes` fields — length-
  prefixed, uncopied, no base64. That is **exactly** §5's binary envelope, to within a few dozen
  bytes of varint headers. Protobuf buys nothing extra on the axis that matters.
- **Decode**: worse than §5's envelope, not better. `protobuf-es`/`protobuf-js` decode `bytes`
  fields by **copying** into fresh `Uint8Array`s, which reinstates exactly the O(frame) pass F13
  measures away. A hand-rolled envelope can hand back views over the received `ArrayBuffer`;
  a generated protobuf decoder will not.
- **Schema/codegen**: this is the decisive cost. Wails already generates the TypeScript bindings
  and models for twelve services from the Go structs, and this repo depends on the exact flavour of
  that output (P3 F7: `-b` and `-names` are load-bearing for `vite.config.ts`, `tsconfig`, and
  `tests/ui/support/mockRuntime.ts`). A `.proto` schema would **not replace** that generator — the
  control plane would still be Wails-generated — so protobuf is a *second* schema language and a
  *second* codegen step alongside it, with the hand-written `wire.go`↔`data-ops.ts` mirror pair
  replaced by a third source of truth that neither side's existing validation (`Validate()`, zod)
  is written against.
- **Validation**: protobuf's "schema" is field presence and type, not the constraints
  `wire.go`'s eight `Validate()` methods actually enforce (`pageSize ∈ {10,100,1000,10000}`,
  cursor mode enums, 4096-char filter caps). Every one of those checks would still have to exist
  by hand afterwards.

FlatBuffers and Cap'n Proto share protobuf's codegen cost and add their own build-time compilers,
in exchange for zero-copy access this app can get from an `ArrayBuffer` view.

### F19 — Arrow IPC (and Arrow Flight) — the closest fit, and the most interesting rejection

`page.Chunk` **is** Arrow's `Utf8` array layout: validity bitmap + offsets + packed UTF-8 values.
Two of its three buffers are byte-for-byte what Arrow specifies. That makes Arrow IPC a genuine
candidate rather than a category error, and it is the option the SPEC row's "or similar off-the-
shelf options" most plausibly points at for columnar page data.

It is still declined, on four specific mismatches:

1. **Validity polarity is inverted.** Arrow's bitmap is `1 = valid`; `chunk.go:77-82`'s is
   `1 = NULL`. Every producer and both consumers would flip, or every page would carry a
   conversion pass — a conversion pass being the thing this format exists to avoid.
2. **Offsets are `uint32` here, `int32` in Arrow.** Benign at these sizes, but it is a real
   re-specification of `MaxPageSize`/`MaxCellBytes` arithmetic.
3. **`truncated` has no Arrow slot.** It would become a second array or key-value metadata,
   i.e. a hand-built extension on top of the standard — which reintroduces the bespoke framing the
   standard was supposed to remove.
4. **Only one of four page kinds is tabular.** Document, key-value and stream pages reuse the chunk
   codec under fixed semantic names with per-page scalars (`ttlMs`, `memoryBytes`, `redisType`,
   `visibilityTimeoutSeconds`). Expressing those as Arrow record batches plus schema metadata is
   modelling work with no consumer benefit — the renderer's views read named chunks, not schemas.

And the cost is real on both sides: `apache/arrow-go` is a large dependency for a codec this app has
already written in 100 lines, and Arrow's JS package would land in a **WebView bundle** whose RAM
footprint is the explicit subject of the very next phase (P5). Arrow Flight is Arrow-over-gRPC and
inherits all of F17 on top.

### F20 — msgpack / CBOR

The honest small option: a drop-in binary JSON with native byte strings, so base64 disappears
without designing a framing. Rejected because it buys the smallest slice of the ledger for a new
dependency on both sides: it removes the 33% (F12) and part of the decode pass, but a msgpack
decoder still **copies** byte strings out into new buffers (F13's O(frame) pass returns), and it
does nothing at all about F11 — which is where the measured cost actually is, and which C1 fixes
with no dependency.

### F21 — The comparison, on the axes that decide it

| | Desktop transport | Wire vs raw | FE decode | New codegen | Deps added | Places to change (F7) |
|---|---|---|---|---|---|---|
| **Today** | works | 1.33–1.36× | O(frame): 0.23–38 ms | none | none | — |
| **Today + C1** | works | 1.33–1.36× (identical bytes) | unchanged | none | none | 1 (Go only) |
| §5 binary envelope | works | 1.00–1.06× | O(columns): 0.02–0.14 ms | none | none | 3 |
| protobuf over the stream | works | ~1.00× | O(frame) (copying decoder) | **yes, second system** | 2 | 3 + schema |
| Arrow IPC | works | ~1.00× | O(columns) | schema/metadata work | 2 (one in the webview bundle) | 3 + 4 mismatches |
| gRPC / gRPC-Web | **no** (needs a real port + proxy) | ~1.00× | O(frame) | **yes, second system** | 3+ | 3 + a second transport |

---

## 4. Recommendation

### R1 — Do not adopt gRPC, protobuf, Arrow, or msgpack. Keep the hand-built framing

Not because it is what exists, but because every off-the-shelf option loses on at least one axis
this app actually has: gRPC cannot run on the transport the product ships on (F17); protobuf and
msgpack decode by copying, which forfeits the one decode win worth having, and add a second codegen
system next to a bindings generator this repo cannot drop (F18, F21); Arrow is the closest fit and
still needs four hand-built accommodations plus a webview-bundle dependency on the eve of a RAM
phase (F19).

### R2 — Keep the two-plane split, and keep JSON as the envelope on both planes

The control plane is Wails-generated bindings over JSON; the data plane is JSON frames correlated
by id. Both stay. The two planes are not redundant: the control plane gets typed generated bindings
and per-method plumbing for free, the data plane gets one long-lived multiplexed channel with
server-push and cancellation. Merging them would mean writing by hand what the bindings generator
produces, for no measured gain.

### R3 — The format decision, stated concretely (the SPEC row's actual ask)

- **Format**: JSON envelope; bulk columnar buffers as base64 of their exact little-endian bytes —
  **unchanged**.
- **Framing**: one JSON object per frame, `{kind:"req"|"res"|"evt"}`, ids correlating request and
  response, delivered as one Wails stream frame — **unchanged**. Frame boundaries, ordering and
  size limits stay the transport's business (F5), not the application's.
- **Transport-shape implication**: none required now, because the application already speaks to the
  transport through a two-method byte interface (F4) and the framework already carries that
  interface over a real network on demand (F3). **The network-split answer is `-tags server`, not a
  new protocol** — and what it still lacks is authentication and the three local-machine semantics
  of F9, neither of which is a serialization concern.
- **The successor format is chosen and specified now, and deliberately not built** (§5, R5).

### R4 — Land the encoder fix, because it is where the measured cost is

Remove both `json.Marshaler` boundaries from the page codec. Byte-identical output (F11), 6–12x
faster encode, allocations from 2.3–3.8× the frame down to 1.00×, no wire change, no frontend
change, no fixture regeneration (F7). This is C1, and it is the whole of this phase's code.

### R5 — Adopt §5's binary envelope only when one of three named triggers fires

Because after C1 the remaining benefit is: 25% of wire bytes (F12) and 0.2–3.4 ms of main-thread
decode per page view at the configurable page sizes (F13) — against a permanent second hand-built
format with three implementations to keep in sync (F7), an alignment rule that fails loudly only if
you are lucky (F13), and a frame you can no longer read in a debugger. Today's numbers do not carry
that. **Build §5 when any of these becomes true, and not before:**

1. `apps/kira-studio/tests/ui/budgets.spec.ts` fails a page-load, tab-switch or scroll budget with
   frame decode implicated in the trace (i.e. the cost F13 measures becomes a *budget* problem, not
   a table in a document).
2. The default page size rises above 1 000 rows, or a page kind starts carrying binary column data
   (an image/blob preview column) — either of which moves the typical frame an order of magnitude.
3. A real frontend/backend split is undertaken, at which point wire bytes stop being free (F12
   shows compression does not recover them) and the envelope should land as part of that work.

---

## 5. The successor format, specified

Recorded here so that adopting it later is a build, not a re-analysis. **This is not implemented in
P4** (D5).

**Frame layout** — one Wails stream frame, binary:

```
magic     u32   'K','I','B','1'      (little-endian 0x314B4942)
headerLen u32   byte length of headerJSON, padded to a multiple of 4
headerJSON      the exact frame JSON of today, with every chunk buffer replaced by
                {"off":<u32>,"len":<u32>} into the payload section
payload         concatenated buffers; every uint32-typed section starts on a 4-byte boundary
```

- **The envelope stays JSON.** `kind`/`id`/`ok`/`error`, and every scalar field of every page kind,
  are unchanged text — so error frames, `ping`, `cache:stats` and every non-bulk response keep
  working with no special case, and the format stays legible.
- **The padding rule is load-bearing, not tidiness** (F13): a `Uint32Array` view whose byte offset
  is not a multiple of 4 throws `RangeError`, and the tempting fix — copying instead of viewing —
  silently discards the entire decode win.
- **Transport**: `port.ts` opens `Stream('engine')` instead of `JSONStream('engine')` (F8) and does
  its own `JSON.stringify` on send. Both Wails transports already carry binary frames — the desktop
  poll natively, server mode as `websocket.MessageBinary` (F2, F3) — so the choice is portable
  across the split by construction.
- **Backward compatibility: none, deliberately.** Both ends ship together in one binary; a
  dual-format decoder would be exactly the "stubbed compatibility path" `AGENTS.md` forbids. The
  magic word exists so a stale cached frontend fails loudly instead of misparsing — the same reason
  Wails' own `streamMagic` exists.
- **Blast radius when it is built** (F7): Go encoder in `internal/page`; decoder in `port.ts`;
  the JS mock encoder in `tests/ui/support/mockStreamBrowser.js`. Not the `tests/ipc` fixture
  corpus.

---

## 6. Decisions

| # | Decision | Justified by |
|---|---|---|
| **D1** | **Keep both planes exactly as they are — Wails bindings for the twelve control services, one named JSON-framed stream for the data plane.** | F1/F21: the control plane's bindings and models are generated from the Go structs today; no alternative removes that generator, so every alternative *adds* a schema system rather than replacing one. The data plane's frame shape is already id-correlated, cancellable and multiplexed. |
| **D2** | **Reject gRPC / gRPC-Web.** | F17: it cannot run over the custom-URI-scheme transport the product ships on, browsers cannot originate it, and the local-TCP-port workaround gives up the exact property `pkg/application/stream.go`'s design states it exists to preserve. Its streaming flow control would replace F5's three already-designed layers with something less specific. |
| **D3** | **Reject protobuf/FlatBuffers/Cap'n Proto/msgpack as the serialization.** | F18/F20/F21: on this payload their wire win *is* §5's envelope (the bulk is opaque `bytes` either way), their generated JS decoders copy where a view would do (reinstating F13's cost), they add a second codegen/schema system next to the bindings generator, and none of them touches F11 — which is where the measured cost actually is. |
| **D4** | **Reject Arrow IPC / Arrow Flight**, despite `page.Chunk` being Arrow's `Utf8` layout. | F19: inverted validity polarity, `uint32` vs `int32` offsets, no slot for `truncated`, and three of four page kinds not being tabular — four hand-built accommodations on top of a standard adopted to avoid hand-building. Plus an Arrow JS dependency in the webview bundle immediately before P5 (RAM). |
| **D5** | **Specify the binary envelope (§5) and do not build it in P4**, with three named adoption triggers (R5). | F11 + F13: after C1 the Go-side gap to binary is ~10–15% of the original cost, leaving 25% of wire bytes and 0.2–3.4 ms of main-thread decode as the remaining prize — against a second hand-built format with three implementations (F7) and an alignment rule that fails silently if fudged (F13). F4 is why deferring costs nothing: the encoding is isolated behind two functions. |
| **D6** | **Remove both `json.Marshaler` boundaries from the page codec: `Uint32LE` and the four page `MarshalJSON` methods, replaced by plain struct tags and `[]byte` buffers.** Output stays byte-identical. | F11: 6–12x encode, allocations from 2.3–3.8× the frame to 1.00×, on a cost paid per page *view* including every server-side cache hit (F14). F7: nothing outside `internal/page` reads `Offsets`/`Truncated` directly — only the `IsNull`/`CellText` accessors — so the change is contained to one package. |
| **D7** | **Do not cache encoded frames alongside cached pages.** | F14: it would roughly double L2's memory against the same user-visible budget, immediately before P5 (RAM), to save work C1 already reduces 8x. |
| **D8** | **Do not retune `adapterhost.Session`'s 32 MiB/64-frame queue, and do not remove its writer goroutine.** | F15: both observations (a 32 MiB budget in front of Wails' 8 MiB one; A18's data-race rationale not matching this Wails version's documented `Send`) are real, but neither has a measurement showing benefit, and the session also owns the per-op context and the in-flight semaphore. P5 owns RAM; OQ-3 hands it over with the specific numbers. |
| **D9** | **Record the measurements in `docs/PERF.md` §2.6 and the protocol decision in `docs/ARCHITECTURE.md`, and fix the "WebSocket" the Process-model diagram claims.** | `AGENTS.md`: facts about the app belong in `docs/ARCHITECTURE.md`, and `docs/PERF.md` §2.5 is the standing precedent for a before/after encoding measurement. F2: on a desktop build the data plane is a held poll plus a POST, and only a `-tags server` build makes it a real WebSocket — the diagram currently says the opposite. |

---

## 7. Implementation order

Three commits. §8.1's block runs after each one, not once at the end.

- **C1 before C2**, because C2 records C1's own before/after numbers.
- **C3 last**, because it describes the finished state.

### C1 — `perf(page): encode a page without the nested json.Marshal round trips`

Contained to `apps/kira-studio/internal/page/` (chunk.go, builder.go, scratch.go). No other package
compiles against the changed fields (F7: external callers use `page.IsNull`/`page.CellText` only —
`internal/ipcfixture/decode.go:60,63,78,81` and `internal/adapters/testsupport/spec.go:45,48,58,61`).

1. **`chunk.go`** — `Chunk.Offsets` and `Chunk.Truncated` become `[]byte`, holding the same
   little-endian bytes they marshal to today. Delete the `Uint32LE` type and both of its
   marshalers (including the `UnmarshalJSON` that `chunk.go:46-47` says exists only so tests can
   round-trip — with `[]byte` both directions are `encoding/json`'s own).
2. **`chunk.go` accessors** — `CellText` reads its two offsets with `binary.LittleEndian.Uint32`;
   `IsNull` is unchanged; `ChunkByteSize` becomes the sum of four `len()`s (the same number it
   returns today, since `Offsets` was counted `×4`). **`ChunkByteSize`'s value must not change** —
   it is what L2 budgets against, and a changed value silently changes eviction behaviour.
3. **`scratch.go:80-109`** — `finish()` writes 4 LE bytes per row into an exactly-sized
   `make([]byte, (rowCount+1)*4)` instead of a `Uint32LE`, and appends 4 bytes per truncated row.
4. ⚠ **`Truncated` must stay a non-nil empty slice when there are no truncated rows.**
   `Uint32LE.MarshalJSON` today builds `make([]byte, 0)` and hands it to `json.Marshal`, which
   emits `""`. A plain `[]byte(nil)` emits **`null`**, which `port.ts`'s `toTypedArray` would hand
   to `Uint8Array.fromBase64(null)` — a decode failure on the frame path, i.e. exactly the hang
   P2 R2 (task #83) fixed. This is the one line in the commit that fails silently on the Go side
   and loudly on the user's, so §8.3's byte-identity check must cover a page with no truncated
   cells.
5. **`builder.go`** — each of the four page structs gains JSON tags and a leading
   `Kind PageKind \`json:"kind"\`` field set by its builder; the four `MarshalJSON` methods
   (`:91,190,253,326`) are deleted. **Declare `Kind` first** so field order — and therefore the
   emitted byte sequence — is unchanged.
6. `internal/page`'s package comment (`chunk.go:1-8`) still describes the base64 wire form
   correctly; update only the sentence that describes `Uint32LE`'s existence.

Verify: §8.1, then §8.3's byte-identity check and `tests/e2e-real`. The commit message states the
measured before/after for the 100-row and 10 000-row fixtures.

### C2 — `docs(perf): the P4 frame-encoding measurements`

A new `docs/PERF.md` §2.6, in §2.5's own format and immediately after it (§2.5 measured the *wire*
cost of this codec; §2.6 measures the *encode and decode* cost of the same codec, and says so):
F10's fixtures and method, F11's table with C1's before/after, F12's wire and compression table,
F13's decode table with its JavaScriptCore-proxy caveat, and one paragraph naming what §5's
envelope would additionally buy and why R5 defers it.

Verify: §8.1 (`bun run lint` formats Markdown), plus §9's greps.

### C3 — `docs: the FE↔BE protocol decision, and what the data plane's transport actually is`

`docs/ARCHITECTURE.md`'s Process model section:

1. Fix the diagram's `data: one "engine" WebSocket stream` and any prose implying a socket: on a
   desktop build it is a held `GET /wails/stream/poll` plus `POST /wails/stream/send` over the
   asset server's custom URI scheme, deliberately so that no local port is open; it is a real
   binary WebSocket only in a `-tags server` build (F2, F3).
2. Add the decision, in one short block: JSON envelope + base64 columnar buffers, kept; gRPC,
   protobuf, Arrow and msgpack weighed and declined with the one-line reason each; the network-split
   answer is `-tags server` plus F9's three local-machine semantics, not a wire format; the
   successor envelope is specified in this plan and gated on R5's three triggers.
3. Note the layered backpressure bounds (F5) as app-level *and* transport-level, since the section
   currently states the app's and Wails' bounds without saying which one binds first.

`AGENTS.md` is not touched: its one "Known open items" entry (CI workflows) is unaffected, and
`AGENTS.md`'s own rule sends findings to the phase plan, which is this file.

Verify: §8.1, plus §9.

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
GTK4/WebKitGTK headers on Linux (`AGENTS.md`'s Wails section). Use the narrow form for the loop.

Baseline to regress against, measured at `4dd3cc2`: all of the above exit 0;
`go test ./apps/kira-studio/internal/adapterhost/...` and `.../enginecache/...` report `ok`, and
`.../page/...` reports `[no test files]` (F16 — C1 does not change that, per §0.4).

### 8.2 Once, for C1

```sh
bun run test:unit
bun run test:ui                 # needs `bunx playwright install webkit` + its system libs
bun run test:ipc:fe
go test ./...                   # container-backed cases self-skip without Docker
node node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts --project=e2e-real
```

The last one is the gate that matters and is **not optional for C1**: `tests/e2e-real/`'s
`sqlite-real.spec.ts` is the only place in the repository where the real Go encoder meets the real
`port.ts` decoder (F16), it runs unconditionally and Docker-free here, and per `AGENTS.md` it must
be launched through plain Node's Playwright CLI, never `bunx`.

### 8.3 The byte-identity proof — C1's actual correctness claim

"The suites passed" is not evidence for C1, because F16 shows how thin the direct coverage is.
Prove the bytes instead, with a throwaway program (not committed — the P58a M2 / `docs/PERF.md`
§2.5 convention):

1. **At `4dd3cc2`, before C1**: build one page of **each of the four kinds** through the real
   builders — including **at least one chunk with no truncated rows and one with several** (C1 step
   4's `null`-vs-`""` hazard), one page with an empty result set, and one with a NULL-only column —
   marshal each through `dataframe.go:229`'s exact expression, and record `sha256` of every frame.
2. **After C1**: rebuild the same pages the same way and compare. **Every hash must be identical.**
3. Additionally assert the property directly in the same program:
   `bytes.Equal(json.Marshal(before), json.Marshal(after))` for each fixture, so a hash mismatch
   reports *where* rather than just *that*.

If any hash differs, the difference is a wire change and C1's premise is void — stop and re-derive
it rather than adjusting the frontend to match.

### 8.4 The measurement re-run for C2

C2's §2.6 must carry C1's *own* before/after, measured on this tree rather than copied from this
plan's §2. Re-run the F10 fixtures against the pre-C1 and post-C1 codecs (the same scratch-module
copy technique), and report medians of at least three runs with the wide fixture's range rather
than a single number (F11: its wall clock is GC-noisy; its allocation ratio is not).

---

## 9. Acceptance checklist

P4 is done when every line below is true, checked against the tree rather than against this
document:

1. `grep -rn "MarshalJSON" apps/kira-studio/internal/page/` returns **nothing**.
2. `grep -rn "Uint32LE" apps/ packages/ --include='*.go' --include='*.ts'` returns **nothing**.
3. `grep -rn "json:\"kind\"" apps/kira-studio/internal/page/builder.go` shows **four** matches
   (one per page kind), each the first field of its struct.
4. §8.3 has actually been run and every frame hash matched — including the no-truncated-rows case.
   The commit message for C1 says so.
5. `go test ./apps/kira-studio/internal/...` is green, and
   `go test ./apps/kira-studio/internal/ipcfixture/...` in **read** mode still matches the six
   committed fixtures (F7 says it should be untouched by C1; this is the check that it is).
6. `tests/e2e-real`'s sqlite project has been run and passed after C1 (§8.2), or has a **stated**
   reason it could not be.
7. `docs/PERF.md` contains a `### 2.6` section whose numbers were measured on this tree (§8.4), not
   copied from this plan.
8. `grep -n "WebSocket" docs/ARCHITECTURE.md` has no match that describes the **desktop** data
   plane as a WebSocket; the surviving matches are the `-tags server` ones (F2/F3).
9. `docs/ARCHITECTURE.md` names the decision: JSON envelope kept; gRPC/protobuf/Arrow/msgpack
   declined; `-tags server` is the network-split transport; §5's envelope is the gated successor.
10. No dependency was added: `git diff 4dd3cc2..HEAD -- go.mod go.sum package.json bun.lock` is
    empty.
11. No wire-format file changed: `git diff --stat 4dd3cc2..HEAD` names no file under
    `apps/kira-studio/frontend/src/bridge/`, `packages/shared/protocol/`, or
    `apps/kira-studio/tests/` (C1 is byte-identical, so none of them needs to).
12. `git status --porcelain` is clean and the diff contains no `.github/workflows/` file.

---

## 10. Open questions, handed forward

**OQ-1 — the network split is blocked on three local-machine semantics, not on the protocol.**
F9: `FilesService.ChooseSave` opens a native save dialog on the Go side and hands back a path that
`data:objectDownload` writes to on the Go side; secrets live in the Go side's OS keychain;
`internal/preconnect` spawns local processes. Wails' server mode also has **no authentication**
(F3). Any future split has to answer all four before the wire format matters at all. **Owner:
whoever proposes the split, as its first design question — not a protocol phase.**

**OQ-2 — §5's envelope is specified but unbuilt, behind R5's three triggers.** The trigger most
likely to fire first is a budget regression on a large page (F13: 3.4–38 ms of main-thread decode
at the two largest page sizes). Whoever builds it should re-measure F13 in the **real WKWebView**
rather than trusting this plan's Bun/JavaScriptCore proxy, and must not skip §5's 4-byte alignment
rule. **Owner: P5 (RAM), P10 (review round three), or the first session that sees a page-load budget
fail — whichever comes first.**

**OQ-3 — two `adapterhost.Session` observations, measured but not acted on.** F15: the app's
32 MiB queue budget sits in front of Wails' own 8 MiB per-window budget, so the difference is
retained bytes rather than throughput; and A18's stated data-race rationale for the single writer
goroutine does not match this Wails version, whose `Send` is mutex-protected and documented as safe
from any goroutine with a single drainer preserving order. Neither is changed here (D8) because
neither has a measurement showing benefit and the session also owns the per-op context and the
in-flight semaphore. **Owner: P5 (RAM usage), which is the phase that will have the instrument.**

**OQ-4 — `internal/page` has no tests, and the only end-to-end encoder/decoder coverage is one
sqlite spec.** F16. C1 is verified by byte-identity, which is stronger than a unit test would be,
but the *next* change to this codec will not have a byte-identity property to lean on. When §5's
envelope is built, the coverage question has to be answered properly rather than inherited —
most likely by extending `tests/e2e-real/` to a second adapter and a page of each of the four
kinds, since that is the only tier where both real implementations meet. **Owner: whoever builds
OQ-2.**

**OQ-5 — the control plane's bulk payloads were characterised but not measured.** F6:
`TreeService.Children` returns a whole expanded level and `Describe`/`Definition` whole object
metadata, over Wails' chunked JSON HTTP transport, with `internal/tree`'s cache-aside storing them
as marshalled JSON. A schema with thousands of tables is the case nobody has measured, and it is a
different transport from everything §2 covers. **Owner: P5, or a later performance pass — cheap to
measure with `tests/e2e-real/`'s postgres fixture.**
