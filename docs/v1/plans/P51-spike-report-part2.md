# P51 — Spike report, part 2: the renderer↔Go bulk-data bridge, designed from source

> Continues `P51-spike-report-part1.md`. Part 1 read the *client* runtime package
> (`@wailsio/runtime`'s built `dist/`) and found `Stream()`/`WailsSocket` as a real, non-JSON
> primitive. This part reads the **Go-side source** of that same mechanism directly from the module
> cache (`$GOPATH/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/pkg/application/stream*.go` —
> pulled via `proxy.golang.org`, not `wails.io`), which turns out to carry extensive design-rationale
> comments of its own. This is enough to write the concrete bridge design §3.2/§6 ask for, on paper.
> **It is still not an end-to-end live confirmation** — see the last section for why, and it changes
> nothing about §3.4/§3.5/§3.7/§3.8 still needing a macOS machine.

## The Go-side API (`pkg/application/stream.go`)

- `app.HandleStream(name string, handler func(*StreamConn))` registers a handler that runs once per
  connection, on its own goroutine, for as long as the handler blocks on `Receive`/`Context()`.
- `StreamConn` is the moral equivalent of `*websocket.Conn`: `Send([]byte)` / `SendJSON(v)` write to
  the frontend, `Receive()` / `ReceiveJSON(v)` block for the next inbound frame, `Close()` ends it.
  `Send` **queues the slice without copying it** — the caller hands over ownership, which matters for
  a bulk page: it can be built once and hand off directly rather than being copied for the queue.
- **Bounded everywhere, by design, not by omission**: 8 MiB / 256 frames per connection outbound,
  8 MiB / 256 frames inbound, 64 MiB max single frame, a 20 s poll hold, and global ceilings across
  every connection (256 MiB / 8192 frames outbound and inbound, 4096 live connections). Fullness is
  *signalled* (`ErrStreamFull` / HTTP 429 with `Retry-After: 0`), never silently held — the source
  comment is explicit that blocking on backpressure here would starve the one poll a whole window
  depends on, "measured at 25-32% of upload throughput plus outright failure of multi-connection
  uploads" when tried the other way.
- **Reload/navigation is a first-class case, not an afterthought.** Every page load gets a monotonic
  "generation" (`window.name`-based, survives a reload even with storage disabled). A new poll from a
  higher generation in the same window **supersedes and closes** every stream session from an older
  generation in that window automatically. This is a real answer to a question today's `MessagePort`
  code has to hand-roll itself (`src/renderer/bridge/port.ts`'s "closes any previous port, rejects
  everything still pending on the old one") — Wails does the equivalent at the session-management
  layer, for free, for every stream at once.

## The wire protocol (`pkg/application/stream_transport.go`)

Two endpoints on the asset server the app already serves — **confirmed no new listening port**,
consistent with §3.3's "no loopback TCP, no per-launch token" reasoning for the *other* transport:

```
GET  /wails/stream/poll   held up to 20s, returns whatever has arrived
POST /wails/stream/send   one frame (open / data / close) from the frontend
```

- **Binary framing, explicitly not JSON, and the source says why**: `encodeStreamFrames` lays out
  `magic(4) | flags(1) | count(4) | count × (connID(4) | kind(1) | len(4) | payload)` — "frames are
  `[]byte`: base64 inside a JSON envelope would cost 33% on every frame, and a megabyte of JSON also
  costs a parse on the UI thread." This is the same cost §3.2 was worried about for the *default*
  `Call` binding, and this is confirmation the Wails maintainers hit the identical problem and built
  a second, binary-native path specifically to avoid it.
- Control metadata (session id, generation, connection id, frame kind, stream name) travels in
  **headers**, never body or query string — stated reason: WebKitGTK can turn a POST body into query
  params for a custom URI scheme, and WebView2 caps body delivery around 2 MB; headers survive all
  three engines.
- **Chunking and batching both exist independently of the default `Call` transport's own chunking**
  (part 1 found `Call`'s 512 KB `sendChunked`; this is the stream path's parallel mechanism, same
  motivation, different constant: `streamMaxFrameBytes` is 64 MiB, ten times the JSON path's ceiling,
  because the wire format isn't paying JSON's overhead). Several frames for one connection can also
  ride a single POST (`streamHeaderBatch`) specifically to amortize the "~11 cgo calls per request on
  macOS" cost the source names for the scheme-handler round trip.

## The concrete bridge design this supports (what §6 asks for)

Putting part 1 and this part together, the design §2's four channel shapes need is now concrete
rather than hypothetical:

1. **Request/response** (the bulk of the 61 channels) → one Wails service method per channel, per
   §3.1's confirmed service-struct model. Marshalled as JSON over the default `Call` binding — a real
   cost per §3.2, but these are control-plane payloads (settings, tree nodes, connection metadata),
   not the bulk data rows §2.1 says already bypasses main today.
2. **Go→renderer push** (`connectionState`, `settingsChanged`, the `kira:menu:*` channels, …) → Wails'
   own event system (`app.Event.Emit`, confirmed working in the scaffold's `main.go`), which is a
   separate mechanism from `Stream()` per `stream.go`'s own header comment ("deliberately separate
   from the event system... shares no code with Emit/events").
3. **Renderer→main fire-and-forget** (`appFlushed`) → an ordinary `Call` binding; nothing about it is
   bulk or high-frequency.
4. **Bulk data** (today's one `MessagePort`, `kira:port`) → **a named `Stream`**, e.g.
   `app.HandleStream("engine-bulk", handler)`, opened once per renderer session the way today's port
   is attached once per `did-finish-load`. The Go handler reads engine responses off the Go↔Node
   transport (§3.3's `EngineHost.Call`/event fan-out) and calls `StreamConn.Send(rawBytes)` directly
   with whatever bytes the engine produced — **no intermediate JSON re-encode on the Go side is
   required if the engine's own wire format is reused as the stream payload verbatim**, and the
   frontend's `Stream("engine-bulk")` (not `JSONStream`) receives it as `ArrayBuffer` with
   `binaryType: "arraybuffer"`, matching part 1's finding. `docs/ARCHITECTURE.md`'s "bulk data skips
   the main process" invariant does **not** survive literally — a Wails app has no channel out of the
   webview except Wails' own bridge, exactly as §3.3 already noted — but its *intent* (bulk pages
   don't pay a JSON marshal/parse) can survive in this shape, because the stream path is binary by
   construction.
5. **Reload/lifecycle** — the generation-based session superseding above replaces the port
   invalidation logic in `src/renderer/bridge/port.ts` and `src/engine/rpc.ts`'s pending-request
   rejection, without new code on either side needing to hand-roll it.

**What this still does not settle**, honestly: the actual per-request correlation (which stream frame
answers which `Call`-issued request) is not designed here — a `connID`-per-open-connection is not the
same as a request id, and if a single `Stream` serves many concurrent bulk requests it needs its own
framing on top of Wails' frame (e.g., embed the request id as the first bytes of each `Send` payload,
symmetric with how `PortRequest.id` works today). That is real design work the next installment
should do, not something this reading of the source settles by itself.

## Why this is not (yet) an end-to-end live confirmation

Two attempts were made this session to actually drive the wire protocol above against a running
`wails3 dev` server (which the Taskfile confirms listens on a real port, `-port 9245`, for exactly
this dev-mode-in-a-browser use case) — first via `nohup … & disown`, then via the harness's own
`run_in_background` mechanism. Both times the backgrounded `xvfb-run wails3 task dev` process was
torn down (once mid-build, once immediately) before the dev server itself came up, with no Wails-side
error in either case. This reads as this sandbox's own handling of long-lived background processes
across tool-call boundaries, not a Wails limitation — the same category of environment friction as
§3.4/§3.5/§3.7's macOS gap, just Linux-side instead. **The design above is grounded in the actual Go
and JS source of the transport, which is stronger evidence than a black-box HTTP probe would have
been, but nobody has yet watched a real `StreamConn.Send` reach a real browser tab from this
sandbox.** Worth retrying in an environment where a background server survives between commands.
