# P54 — Go `EngineHost`: the tagged stdio transport, and `src/engine/stdio-main.ts`

> Sequences P52's §7.2/§7.3 against the tree as it stands after P53. P52 §4–§10 are settled and
> are not reopened here; where this plan contradicts P52 it is because reading the actual source
> disproved something P52 asserted, and each such case is called out with its evidence (§1.4,
> §1.6). P52 §15: **G1 is the only gate in this migration and it has passed.** No gate here.

## 0. What this phase is, and what it is not

P52's phasing table (~line 70) assigns P54: *"Go `EngineHost` + `src/engine/stdio-main.ts` (a
second, complete entry point) — one new file [in `src/`]"*.

Concretely, three things:

1. **The Go↔Node transport gains its channel tag and its bulk-data plumbing.**
   `shell/internal/enginehost` goes from P52 M1's walking skeleton (one untagged JSON control
   channel, one timeout, one op) to the full §7.2/§7.3 design: a 1-byte channel tag, a bounded
   data queue feeding a renderer-facing Stream sink, per-call timeout overrides, structured
   `ipcerr` errors, real event fan-out, stderr into the logger, and a correct child-exit path.
2. **`src/engine/stdio-main.ts`** — a second, complete entry point over the *unmodified*
   `control.ts` / `rpc.ts` / `cache` modules, alongside `src/engine/index.ts`, which is not
   touched. P57 deletes `index.ts`.
3. **`internal/enginehost/config.go`** — `src/main/engine-config.ts`'s port, which P52 §4.1 assigns
   to this package and which needs nothing P55 owns.

**Not in this phase.** No P55 service (`connections`, `secrets`, `preconnect`, `tree`, `oplog`,
`metrics` beyond what exists). No `bridge.HandleStream` registration and no renderer-side Stream
wrapper — P56's phasing row owns those; P54's job is to shape the Go API so P56 wires it in a
dozen lines with no rework (§4.4). No `SettingsService.Set` (it does not exist yet — P56 owns the
other 52 bridge methods), so the conditional cache re-push after a settings patch is **named here
and deferred to P56** (§2 D11) rather than half-built. No `internal/logging` (§1.6). No `docs/`
updates — P52 §14 assigns those to P57.

## 1. What reading the current tree found

### 1.1 `host.go`'s gap against P52 §7.2/§7.3

The P52 M1 file is 252 lines and does the untagged half correctly. Missing, in P52's own terms:

| Required by | Missing today |
|---|---|
| §7.2 | The 1-byte channel tag. Every frame is treated as a control-channel JSON message; there is no tag on the wire at all. |
| §7.2 | The whole bulk-data path: no `Sink`, no bounded queue, no writer goroutine, no backpressure, no `ErrStreamFull` retry. |
| §7.3 | Per-call timeout override. One `DefaultTimeout = 30 * time.Second`, and `Call` forces every caller to pass a duration. |
| §7.3 | `StderrPipe` pumped into logging under scope `engine`. `cmd.Stderr = os.Stderr` with a comment deferring it. |
| §5.3 | Structured errors. `Call` returns `fmt.Errorf("[%s] %s", code, msg)` — the exact `[CODE] message` folding §5.3 retired. |
| `engine-host.ts:86-90` | The "engine is not running" pre-check, which fails a call immediately instead of after a 30 s timeout. |

### 1.2 Three real defects in the P52 skeleton

Found by reading, not by running. Each is fixed by this phase.

- **`writeFrame` deadlocks the host on a full stdin pipe.** It takes `h.mu` — the same mutex
  `readLoop` takes to deliver a response into the pending map — and holds it across two blocking
  `h.stdin.Write` calls (`host.go:161-167`). If the child stops reading stdin while the host is
  writing, the read loop cannot drain a single response, so the child never gets unblocked either.
  Fix: a separate `writeMu` guarding stdin only, and one `Write` of one pre-assembled buffer.
- **`cmd.Wait()` races the stdout reader.** `waitAndFail` calls `h.cmd.Wait()` (`host.go:97`)
  concurrently with `readLoop`. `os/exec`'s `StdoutPipe` doc is explicit: *"Wait will close the pipe
  after seeing the command exit … it is thus incorrect to call Wait before all reads from the pipe
  have completed."* Today it happens to work because the child exiting produces EOF first, but it
  is a real race and adding a second pipe (stderr) widens it. Fix: `readDone`/`stderrDone` channels,
  both awaited before `Wait()`.
- **`Events()` is not fan-out.** It returns a fresh channel per call but every one of those
  goroutines ranges over the *same* `h.events` channel (`host.go:203-221`), so with two subscribers
  each event is delivered to exactly one of them, chosen by the scheduler. P52 §7.3 names two
  consumers for `engine:down` alone (`connections.markAllErrored`, `oplog`'s reconciliation), plus
  `bridge/events.go` for `kira:connection:state` and `kira:op:update`. Fix: a real subscriber
  registry (§4.2).

### 1.3 `src/engine` has two Electron couplings, and only one is in `index.ts`

P52 §4.4 states: *"`index.ts` is the only file there importing anything from `electron`."* That is
true of the `import` statement and **not** true of the coupling. Two things in the shared modules
break under a plain `node` process:

- **`src/engine/control.ts:10-12`** — `emit()` calls `process.parentPort.postMessage(...)`
  directly. `process.parentPort` is an Electron `utilityProcess` API; it does not exist in Node.
  This is the engine's existing "tell the host something unsolicited" seam and it is used by
  `wireScheduler` for every op event and by `handleConnect` for `ENGINE_EVENT.connectionState`.
- **`src/engine/control.ts:21` and `src/engine/cache/lru.ts:58`** — `console.log` / `console.warn` /
  `console.error`. Under the stdio transport **stdout is the frame channel**, so any `console.log`
  injects raw text between two length-prefixed frames and desynchronises the Go reader. Today's
  Electron host merely logs those bytes (`engine-host.ts:44-45`); here they are protocol corruption.

Both are handled inside `stdio-main.ts` (§2 D6, §2 D7) so that not one byte of `control.ts`,
`rpc.ts`, `data.ts` or `cache/` changes, and P52 §4.4's "one new file" boundary holds literally.

### 1.4 P52 §7.2's `ErrStreamFull` premise is wrong against `v3.0.0-beta.15`

§7.2 says *"`Send` signals fullness (`ErrStreamFull`) at 8 MiB / 256 frames per connection rather
than blocking."* Read for this plan from
`$GOPATH/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/pkg/application/stream.go`:

| Fact | Source |
|---|---|
| `Send` **blocks** while the outbound buffer is full — *"the way a socket write blocks on a full send buffer"* — and returns `ErrStreamClosed` once the connection is gone | `stream.go:224-239` |
| `TrySend` is the non-blocking variant: *"Send without the blocking: it returns `ErrStreamFull` rather than waiting"* | `stream.go:241-250` |
| Per-connection outbound bounds are **8 MiB *and* 256 frames** (`streamOutQueueBytes = 8 << 20`, `streamOutQueueDepth = 256`) | `stream.go:57-70` |
| One frame may not exceed **64 MiB** (`streamMaxFrameBytes = 64 << 20`); over that, both `Send` and `TrySend` return `ErrStreamTooLarge` | `stream_transport.go:50`, `stream.go:235`/`244` |
| `Send` hands the slice over **without copying** — *"Do not mutate or reuse data after passing it to Send"* | `stream.go:230-233` |

Three consequences, all handled in §2:

1. The retry-on-`ErrStreamFull` loop §7.2 mandates is still written (D9), because our `Sink` is an
   interface and a `TrySend`-backed implementation is legitimate — but with Wails' blocking `Send`
   it will normally never spin, and the backpressure chain §7.2 describes (queue fills → read loop
   stops → OS pipe backpressure reaches the engine) is achieved anyway.
2. `ErrStreamTooLarge` is a **new, real limitation this migration introduces**: no single
   engine→renderer data frame may exceed 64 MiB, where Electron's structured clone had no such
   ceiling. Handled in D10 and owed to `docs/ARCHITECTURE.md` at P57.
3. The zero-copy `Send` contract means the Go read loop must hand each data frame's body over as a
   slice it never touches again. §3's framing is chosen so that falls out for free.

### 1.5 The two per-call timeouts, verified against source

P52 §7.3's "30 s default … 20 s connect/test" is accurate, and now pinned to lines:

- `src/main/engine-host.ts:6` — `const DEFAULT_TIMEOUT_MS = 30_000`, applied as the default
  parameter at `:85`.
- `src/main/connections.ts:191` — `ENGINE_OP.connect` with `20_000`.
- `src/main/connections.ts:345` — `ENGINE_OP.test` with `20_000`.
- Every other call site (`tree-service.ts:93/121/141`, `connections.ts:155/310/366`,
  `ipc/ops.ts:18`, `engine-config.ts:23`) passes no timeout and gets the 30 s default.

Error codes, also from `engine-host.ts`: `E_TIMEOUT` on timeout (`:95`), `E_ENGINE_DOWN` with
message `engine process exited` on child exit (`:74`) and `engine process is not running` on the
pre-check (`:88`), and `message.error.code ?? 'E_QUERY'` for an error response (`:56`).

### 1.6 `internal/logging` does not exist, and P54 does not create it

Confirmed: `shell/internal/` holds `appcore bridge config enginehost id metrics storage`. P53's
scope boundary already decided the pattern — *"repos use `slog.Default()`, and a later phase
installs the file handler with `slog.SetDefault`, changing no repo."*

`enginehost` uses the identical seam: `slog.Default()` with `slog.String("scope", "engine")`. When
P55 ports `src/main/log.ts` into `internal/logging` and calls `slog.SetDefault`, every engine line
lands in `logs/kira-YYYY-MM-DD.log` with **zero change to this package**. So P52 §7.3's *"`StderrPipe`
pumped line-wise into `logging` under scope `engine`"* is satisfied in full at P54 — the sink is
late-bound, which is the point of the seam. This is not a deferral and not a stub.

## 2. Decisions

**D1 — Wire format: `length (uint32 BE) | tag (uint8) | body`, where `length` is the body's byte
length and excludes the tag.** Justification in §3.

**D2 — The read guard and the send ceiling are different numbers, deliberately.**
`maxFrameBytes = 128 << 20` guards the *length prefix* against a desync (a garbage length must not
become a 4 GiB allocation); exceeding it is a protocol error that SIGKILLs the child.
`maxDataFrameBytes = 64 << 20` is Wails' own `streamMaxFrameBytes` (§1.4) and is a *policy* limit on
what may be handed to a `Sink`; exceeding it drops the frame with an error log. Making them one
number would turn a legitimately-oversized page into a killed engine.

**D3 — An unknown tag is skipped, a bad length is fatal.** The framing is length-delimited, so an
unknown tag is fully recoverable: read the body, discard it, log once at `warn`, carry on. A length
over `maxFrameBytes` is not recoverable — the stream position is meaningless — so it kills the child
and lets the existing `E_ENGINE_DOWN` path do its job.

**D4 — `Call(op, payload)` / `CallTimeout(op, payload, d)`, with `DefaultTimeout = 30s` and
`ConnectTimeout = 20s` as exported constants.** Go has no default arguments; splitting the method is
the idiomatic way to make the 30 s path the easy one (every call site but two) and the 20 s path
explicit. `Call` is exactly `CallTimeout(op, payload, DefaultTimeout)`. `ConnectTimeout`'s doc
comment names `src/main/connections.ts:191` and `:345` as its only two callers-to-be, so P55 does
not have to rediscover them. Free to change: `Call` has **zero** callers in the Go tree today
(`grep` for `.Call(` under `shell/` returns nothing).

**D5 — `enginehost` returns `*ipcerr.Error`, not a bare `error`.** `internal/bridge/ipcerr` is a
leaf package (it imports only `encoding/json`), so `enginehost` importing it creates no cycle, and
the engine's own wire errors already *are* `{code, message}`. Folding them into another type and
re-expanding at the bridge is precisely the lossy layering P52 §5.3 retired. The mapping:

| Situation | Returned |
|---|---|
| Host not alive at call time | `ipcerr.EngineDown()` (`"the engine process is not running"`) |
| stdin write fails | `ipcerr.EngineDown()` — a dead pipe is a dead engine |
| Child exits with the call pending | `ipcerr.New("E_ENGINE_DOWN", "engine process exited")` |
| Timeout | `ipcerr.New("E_TIMEOUT", fmt.Sprintf("engine call %q timed out", op))` |
| `ok:false` response | `ipcerr.New(code, message)`, `code` defaulting to `E_QUERY` when absent |

**D6 — `stdio-main.ts` defines `process.parentPort`, so `control.ts` stays byte-identical.** It is a
two-property object whose `postMessage` writes a tag-0 frame. This is not a shim around a missing
capability; it *is* the capability, re-pointed at the new host. Safe by construction: `control.ts`'s
module body only *stores* `emit` (via `wireScheduler`), never calls it at import time, and
`stdio-main.ts` installs the property before it reads a byte of stdin. At P57, when `index.ts` is
deleted, `control.ts`'s `emit` can be pointed at the stdio writer directly and the property removed.

**D7 — `stdio-main.ts` rebinds `console` to stderr.** One line: `globalThis.console = new
Console({stdout: process.stderr, stderr: process.stderr})`. This is mandatory, not hygiene (§1.3).
It also makes the engine's `AdapterDeps.log` output arrive on the one stream the Go host is already
pumping into `slog`, which is what preserves today's single-log-file property. **Known residual
risk, stated rather than papered over:** a third-party driver that writes to `process.stdout`
directly would still corrupt the stream. Nothing in `src/engine` does, the console rebind covers
every call this repo makes, and D3's desync detection turns any such write into a loud, named
failure rather than silent corruption. P57's real-adapter cutover re-verifies it.

**D8 — Engine stderr is logged at `info`, not `error`.** `engine-host.ts` logs stdout at `info` and
stderr at `error`; under stdio there is only stderr, carrying both. Labelling every ordinary
`console.log` from an adapter as an error is worse than under-labelling a genuine failure whose own
text already says what it is — and the genuine failure signal is not the text anyway, it is the
non-zero exit code, which `waitAndFail` logs at `warn` under scope `engine-host` in the same words
`engine-host.ts:67` uses.

**D9 — Backpressure: a 64-frame / 32 MiB bounded queue, a writer goroutine, and an
indefinitely-retried but interval-bounded backoff.** P52 §7.2's numbers stand — reading
`stream.go` (§1.4) changes the *mechanism* but not the sizing, and 64 frames / 32 MiB sits
comfortably above Wails' own per-connection 256 / 8 MiB and far above anything the engine can have
in flight. Backoff: **2 ms, doubling, capped at 50 ms, retried indefinitely**, aborting only on host
stop or when the sink is superseded. "Indefinitely" is not a hang: §7.2 states the policy plainly —
the queue fills, the read loop stops reading stdout, OS pipe backpressure reaches the engine, *"in
which case stalling is correct behaviour, not a bug to paper over."* Dropping instead would surface
as an unexplained 30 s timeout in the renderer. **No new error code is invented** (§7.2).

**D10 — A data frame over `maxDataFrameBytes` is dropped with an error log, and this is recorded as
a new limitation.** Go does not parse data frames (§7.2), so it cannot know the frame's request id
and cannot synthesise a `PortResponse` error; the renderer's own 30 s pending timeout is what the
user sees. The log line names the size and the limit. Owed to `docs/ARCHITECTURE.md` and
`docs/PERF.md` at P57 — it is the one place the Stream transport is strictly less capable than
Electron's structured clone.

**D11 — `PushCacheConfig` ships; the settings re-push does not.** `internal/enginehost/config.go`
ports `src/main/engine-config.ts` verbatim, including its central contract — *"log the failure,
never throw — a settings save must not fail because the engine is mid-restart."* It is called once
from `main.go` after `enginehost.Start`, mirroring `src/main/index.ts`'s startup ordering. The
second caller — `ipc/settings.ts`'s conditional re-push when `cache.l2BudgetMb` changes — cannot
exist yet because `bridge.SettingsService` has only `GetAll()`; P52 §4.2's `settings.go` row already
owns it and **P56 must add it alongside `SettingsService.Set`**. Named here so it is not lost.

**D12 — `Stop()` is SIGTERM-then-SIGKILL, not a bare `Process.Kill()`.** Today's `Stop` sends
SIGKILL, while `engine-host.ts:112` sends SIGTERM (`child.kill()`) and both engine scripts install
a `SIGTERM` handler. Order: close stdin (which `stdio-main.ts` treats as the shutdown signal), send
SIGTERM, wait up to 2 s on `Down()`, then SIGKILL. Idempotent via `sync.Once`.

**D13 — The child's environment is scrubbed.** `NODE_OPTIONS` and `NODE_REPL_EXTERNAL_MODULE` are
cleared on the spawned command. P52 §10.2 calls this *"the one part of the fuses' protection that
genuinely ports, and it is not optional"*; it is one line in the spawner and this is the spawner.

**D14 — `enginehost` never imports Wails.** The renderer-facing sink is a one-method interface
(`Sink`) defined here. This keeps `go test ./internal/...` free of the GTK/WebKit dev headers — the
exact distinction `AGENTS.md`'s P53 findings tell the next session to preserve — and lets the stream
tests use a fake sink that can be made full, closed or slow on demand.

## 3. The wire format

```
byte   0 1 2 3    4      5 …
      +--------+------+------------------+
      | length | tag  | body             |
      | uint32 | uint8| length bytes     |
      |   BE   |      | UTF-8 JSON       |
      +--------+------+------------------+

tag 0 = control   PortRequest / PortResponse / PortEvent, parsed by Go
tag 1 = data      PortRequest / PortResponse / PortEvent, opaque to Go
```

`length` is the **body's** byte length and does **not** include the tag byte. Three reasons this is
the right choice over folding the tag into the length:

1. **`length` keeps meaning exactly what it means today.** `p51-spike-artifacts/gonode/main.go`,
   `gonode/engine_stub.mjs` and `shell/testdata/engine-ping.mjs` all write "4-byte BE length of the
   JSON body, then the body", and part 1 and part 4 validated that framing on two platforms. Under
   this layout every one of those files changes by exactly one read and one write of one byte; under
   the alternative, the meaning of the field silently changes and every off-by-one is a live bug in
   a format nobody can inspect by eye.
2. **The body is allocated at its own exact size, in its own slice.** `make([]byte, length)` then
   `io.ReadFull` yields a slice the read loop never touches again, which is precisely what Wails'
   zero-copy `Send` requires (§1.4: *"Do not mutate or reuse data after passing it to Send"*). Under
   the alternative the body is a `frame[1:]` subslice whose backing array's first byte is protocol
   metadata handed to the transport for the lifetime of the frame.
3. It matches P52 §7.2's own diagram (`len(4)|tag=1|body`) read in the most natural way.

Both sides therefore read: 5 header bytes → `length` → `tag` → `length` body bytes. Both sides
write: one buffer of `5 + len(body)`, one write call. There is no shared schema file and none is
needed — the format is five bytes of header described in one comment on each side, each comment
naming the other file.

## 4. Target tree, file by file

```
shell/internal/enginehost/
  frame.go          NEW   the tag/length framer, read + encode
  frame_test.go     NEW   internal test: round trip, oversize, split reads, unknown-tag resync
  host.go           REWRITTEN in place
  host_test.go      NEW
  stream.go         NEW   Sink, ErrStreamFull, bounded queue, writer goroutine, retry
  stream_test.go    NEW
  config.go         NEW   src/main/engine-config.ts's port
  helpers_test.go   NEW   node resolution + newHost(t)
  testdata/
    engine-fixture.mjs  NEW  the tagged-protocol test child
  stdio_main_integration_test.go  NEW  opt-in, runs the real bundled src/engine
shell/testdata/engine-ping.mjs     UPDATED  tag byte + configureCache
shell/main.go                      UPDATED  PushCacheConfig after Start
src/engine/stdio-main.ts           NEW      the one file under src/
package.json                       UPDATED  one script, build:engine
```

### 4.1 `internal/enginehost/frame.go`

```go
const (
	frameTagControl byte = 0
	frameTagData    byte = 1
	frameHeaderLen       = 5
	maxFrameBytes        = 128 << 20 // D2: desync guard on the length prefix, not a policy limit
)

var errFrameTooLarge = errors.New("enginehost: frame length exceeds the protocol limit")

// readFrame reads one `length|tag|body` frame. body is a fresh slice sized exactly to the frame,
// so a data frame can be handed to a Sink without a copy (P52 §7.2).
func readFrame(r io.Reader) (tag byte, body []byte, err error)

// encodeFrame returns one buffer for one Write — the header and the body must not be two writes,
// or two concurrent writers interleave.
func encodeFrame(tag byte, body []byte) []byte
```

`readFrame`: `io.ReadFull` 5 bytes; `n := binary.BigEndian.Uint32(hdr[:4])`; `n > maxFrameBytes` →
`errFrameTooLarge`; `body := make([]byte, n)`; `io.ReadFull`. Returns `hdr[4]`.

### 4.2 `internal/enginehost/host.go`

Struct changes:

```go
type Host struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser

	writeMu sync.Mutex          // §1.2: guards stdin only, never held with mu

	mu      sync.Mutex          // guards pending, nextID, subs, subsClosed
	pending map[int]chan portResponse
	nextID  int
	subs    map[uint64]chan Event
	nextSub uint64
	subsClosed bool

	readDone   chan struct{}    // §1.2: both awaited before cmd.Wait()
	stderrDone chan struct{}
	down       chan struct{}
	downOnce   sync.Once
	stopping   chan struct{}
	stopOnce   sync.Once

	// stream.go's fields
	dataOut     chan []byte
	queuedBytes atomic.Int64
	sinkMu      sync.Mutex
	sink        Sink
	sinkGen     uint64
}
```

`Start` — unchanged signature (`nodeBin, script string, nodeArgs ...string`). Adds:
`cmd.Env = scrubbedEnv()` (D13, dropping `NODE_OPTIONS` and `NODE_REPL_EXTERNAL_MODULE` from
`os.Environ()`); `stderr, err := cmd.StderrPipe()` replacing `cmd.Stderr = os.Stderr`; starts
`readLoop`, `pumpStderr`, `waitAndFail` and `streamWriter`.

`readLoop(stdout)` — `defer close(h.readDone)`; `bufio.NewReaderSize(stdout, 64<<10)`; loop on
`readFrame`; on `errFrameTooLarge` log at error under scope `engine` and `h.kill()` (unexported,
immediate SIGKILL, **no wait** — calling the public `Stop()` from here would deadlock on `down`,
which cannot close until this loop returns); switch on tag: `frameTagControl` →
`handleControlFrame(body)` (today's `kind` probe, `res` into the pending map, `evt` published to
subscribers), `frameTagData` → `enqueueData(body)`, default → `slog.Warn` and continue (D3).

`pumpStderr(stderr)` — `defer close(h.stderrDone)`; `bufio.Scanner` with
`sc.Buffer(make([]byte, 0, 64<<10), 1<<20)` so a long stack-trace line is not silently truncated at
Go's 64 KiB default; each non-empty line → `slog.Info(line, "scope", "engine")` (D8).

`waitAndFail` — `<-h.readDone; <-h.stderrDone; err := h.cmd.Wait()`; log at `warn` under scope
`engine-host` in `engine-host.ts:67`'s words; fail every pending call with
`portResponse{OK:false, Error:&portError{Code:"E_ENGINE_DOWN", Message:"engine process exited"}}`;
publish `Event{Topic: EventEngineDown}` to every subscriber **before** closing their channels, so a
subscriber ranging over events sees it in order after the engine's own last events — which is what
`oplog`'s in-flight reconciliation needs at P55; close subscriber channels; set `subsClosed`;
`close(h.down)`; close the data queue so `streamWriter` exits.

`Call` / `CallTimeout` — per D4/D5. `CallTimeout` checks `Alive()` first, allocates the id under
`mu`, writes `encodeFrame(frameTagControl, marshalled)` under `writeMu`, then selects on the
response channel and `time.After(timeout)`, deleting the pending entry on the timeout path exactly
as today.

Event fan-out — replaces `Events()`:

```go
type Event struct {
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

const EventEngineDown = "engine:down"

// Subscribe returns this subscriber's own buffered channel and its unsubscribe func. Each
// subscriber gets every event (§1.2 — the previous shape delivered each event to exactly one of
// them). Subscribing after the child has exited returns an already-closed channel.
func (h *Host) Subscribe() (<-chan Event, func())
```

Per-subscriber buffer 32; publish is a non-blocking send with a `slog.Warn` naming the topic on
overflow, so one stalled consumer never blocks the read loop — today's stated property, kept.

`Down()` / `Alive()` / `PID()` unchanged. `Stop()` per D12.

### 4.3 `internal/enginehost/stream.go`

```go
// ErrStreamFull is what a Sink returns when it has no room for the frame right now and did not
// take it. enginehost retries on errors.Is(err, ErrStreamFull) and treats every other error as
// "this session is gone".
var ErrStreamFull = errors.New("enginehost: stream sink full")

// Sink is the whole of what enginehost needs from a renderer-facing stream session — deliberately
// one method, so this package never imports Wails (D14). P56 satisfies it with a ~10-line adapter
// over *application.StreamConn; note that Wails' own Send blocks rather than returning its
// ErrStreamFull (that is TrySend), so the adapter may pass Send straight through.
type Sink interface {
	Send(frame []byte) error
}

// maxDataFrameBytes is Wails' own streamMaxFrameBytes (pkg/application/stream_transport.go:50).
// A var, not a const, so stream_internal_test.go can lower it (D10).
var maxDataFrameBytes = 64 << 20

const (
	dataQueueFrames = 64
	dataQueueBytes  = 32 << 20
	sendBackoffMin  = 2 * time.Millisecond
	sendBackoffMax  = 50 * time.Millisecond
)

// AttachStream makes s the current sink, superseding any previous one, and returns the detach
// func. With no sink attached, data frames are consumed and dropped — the Go-side analogue of
// index.ts's D16 ("a no-op when no port is attached").
func (h *Host) AttachStream(s Sink) (detach func())

// SendData writes one renderer-originated frame to the engine on the data channel. Go does not
// parse it.
func (h *Host) SendData(frame []byte) error
```

`enqueueData(body)` (called from `readLoop`): spin while
`h.queuedBytes.Load() >= dataQueueBytes`, selecting on `h.stopping` and a 2 ms timer; then
`h.queuedBytes.Add(int64(len(body)))` and `select { case h.dataOut <- body: case <-h.stopping:
return }`. The blocking send into a cap-64 channel is what stops the read loop, which is what
propagates OS pipe backpressure to the engine (§7.2).

`streamWriter()`: `for body := range h.dataOut { h.queuedBytes.Add(-int64(len(body)));
h.deliver(body) }`.

`deliver(frame)`: if `len(frame) > maxDataFrameBytes`, `slog.Error` naming the size and the limit,
return (D10). Otherwise loop: read the current sink and its generation; `nil` → return (drop);
`sink.Send(frame)`; `nil` error → return; not `ErrStreamFull` → detach that generation, `slog.Warn`,
return; `ErrStreamFull` → sleep `delay` (selecting on `h.stopping`), abandon the frame if the sink
generation changed while sleeping (it belongs to a dead session), then `delay = min(delay*2,
sendBackoffMax)` and retry (D9).

**What P56 writes on top of this, unchanged from here:**

```go
app.HandleStream("engine", func(conn *application.StreamConn) {
	detach := host.AttachStream(wailsSink{conn})
	defer detach()
	for {
		frame, err := conn.Receive()
		if err != nil {
			return
		}
		if err := host.SendData(frame); err != nil {
			return
		}
	}
})
```

### 4.4 `internal/enginehost/config.go`

```go
// PushCacheConfig pushes engine-relevant settings (today: the L2 cache byte budget) into the
// engine. Failures are logged, never returned — a settings save must not fail because the engine
// is mid-restart (src/main/engine-config.ts).
func PushCacheConfig(h *Host, settings model.Settings)
```

`h.Call("engine:configure-cache", map[string]any{"l2BudgetBytes": settings.Cache.L2BudgetMb * 1024
* 1024})`, error logged at `warn` under scope `engine-config` in `engine-config.ts`'s own words. The
op string must match `ENGINE_OP.configureCache` in `src/shared/protocol/engine-ops.ts` — read the
literal from that file rather than retyping it from here.

`main.go` calls it once, immediately after `enginehost.Start`, mirroring `src/main/index.ts`'s
startup ordering ("start engine → … → push engine config").

### 4.5 `shell/testdata/engine-ping.mjs`

The app's own dev/G1 engine child. Two changes, both required or the app stops working the moment
`host.go` starts writing a tag byte:

- The framer gains the tag byte on both sides (read 5-byte header, write `5 + len`), and echoes each
  response back on the tag it arrived on.
- One new op, `engine:configure-cache`, returning `{}`, so §4.4's startup push does not log a
  spurious `E_UNKNOWN_OP` on every boot.

Nothing else changes: it still deliberately does not load `src/engine` (P52 §3.2's measurement
premise), and `resolveEngine()` in `main.go` still points at it.

### 4.6 `src/engine/stdio-main.ts` — the one new file under `src/`

Complete, in full. Every behaviour of `index.ts` that is not the Electron transport is accounted
for below the code.

```ts
// The engine's second, complete entry point (P52 §4.4/§7.3): the same control.ts / rpc.ts / cache
// modules index.ts wires, over a framed stdio pipe to the Go shell instead of Electron's
// parentPort + MessagePort pair. index.ts is untouched and both entry points are whole for the
// coexistence window; P57 deletes index.ts.
//
// Frame: | length uint32 BE | tag uint8 | body (UTF-8 JSON) |, length excluding the tag.
// tag 0 = control (handleFrame), tag 1 = data (dispatch). The Go side is
// shell/internal/enginehost/frame.go.

import { Console } from 'node:console';
import { PORT_EVENT } from '@shared/protocol/data-ops';
import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';
import { cache } from './cache';
import { handleFrame } from './control';
import { dispatch } from './rpc';

const TAG_CONTROL = 0;
const TAG_DATA = 1;
const HEADER_BYTES = 5;
const MAX_FRAME_BYTES = 128 * 1024 * 1024;

// stdout is the frame channel here, not a log sink: a stray console.log lands between two frames
// and desynchronises the Go reader. control.ts's AdapterDeps.log and cache/lru.ts both use
// console, so every console method is repointed at stderr — which the Go host pumps into its own
// logger, preserving the single-log-file property.
const out = process.stdout;
globalThis.console = new Console({
  stdout: process.stderr,
  stderr: process.stderr,
}) as unknown as typeof console;

let stdinPaused = false;

function writeFrame(tag: number, message: PortResponse | PortEvent): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
  frame.writeUInt32BE(body.length, 0);
  frame.writeUInt8(tag, 4);
  body.copy(frame, HEADER_BYTES);
  if (!out.write(frame) && !stdinPaused) {
    // The Go host stops reading stdout when its own bulk-data queue fills (P52 §7.2). Honouring
    // that here turns the resulting pipe backpressure into "stop taking new work" rather than an
    // unbounded write buffer inside this process.
    stdinPaused = true;
    process.stdin.pause();
  }
}

out.on('drain', () => {
  if (stdinPaused) {
    stdinPaused = false;
    process.stdin.resume();
  }
});

// control.ts's emit() posts unsolicited events through process.parentPort — the engine's existing
// "tell the host" seam. Under stdio the host is the Go process and the seam is a tag-0 frame;
// defining it here is what lets control.ts stay byte-identical. Safe before any emit: control.ts's
// module body only stores emit (wireScheduler), and nothing emits before a request arrives.
Object.defineProperty(process, 'parentPort', {
  configurable: true,
  value: {
    postMessage: (message: PortResponse | PortEvent) => writeFrame(TAG_CONTROL, message),
  } as unknown as typeof process.parentPort,
});

// index.ts's D16 "no-op when no port is attached" moves to the Go side, which drops data frames
// while no renderer stream is attached. The engine always writes them.
cache.onStatsChanged((stats) =>
  writeFrame(TAG_DATA, { kind: 'evt', topic: PORT_EVENT.cacheStats, payload: stats }),
);

let buf = Buffer.alloc(0);

process.stdin.on('data', (chunk: Buffer) => {
  buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < HEADER_BYTES) return;
    const length = buf.readUInt32BE(0);
    if (length > MAX_FRAME_BYTES) {
      console.error(`[engine] frame length ${length} exceeds the protocol limit; exiting`);
      process.exit(1);
    }
    if (buf.length < HEADER_BYTES + length) return;
    const tag = buf.readUInt8(4);
    const body = buf.subarray(HEADER_BYTES, HEADER_BYTES + length);
    buf = buf.subarray(HEADER_BYTES + length);
    handleIncoming(tag, body);
  }
});

// stdin closing is the shutdown signal: the engine outlives a renderer reload but not the app,
// and there is no parentPort 'close' analogue here.
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function handleIncoming(tag: number, body: Buffer): void {
  let request: PortRequest;
  try {
    request = JSON.parse(body.toString('utf8')) as PortRequest;
  } catch {
    console.error('[engine] dropped an unparseable frame');
    return;
  }
  if (request.kind !== 'req') return;

  if (tag === TAG_CONTROL) {
    // handleFrame and dispatch are total today — both catch internally and resolve a PortResponse.
    // The rejection arm exists because an unhandled rejection would take the whole engine down
    // under Node's default policy, and losing every connection to one malformed op is not an
    // acceptable failure mode.
    handleFrame(request).then(
      (response) => writeFrame(TAG_CONTROL, response),
      (err: unknown) => writeFrame(TAG_CONTROL, failure(request.id, err)),
    );
    return;
  }
  if (tag === TAG_DATA) {
    // `transfer` has no analogue over a pipe and is always undefined anyway (rpc.ts's own doc
    // comment) — the destructure drops it deliberately, not by omission.
    dispatch(request).then(
      ({ response }) => writeFrame(TAG_DATA, response),
      (err: unknown) => writeFrame(TAG_DATA, failure(request.id, err)),
    );
    return;
  }
  console.error(`[engine] dropped a frame with unknown channel tag ${tag}`);
}

function failure(id: number, err: unknown): PortResponse {
  return {
    kind: 'res',
    id,
    ok: false,
    error: { message: err instanceof Error ? err.message : String(err) },
  };
}
```

**Everything `index.ts` does, and where it went.** Checked line by line so the two entry points are
behaviourally equivalent except for transport:

| `index.ts` | `stdio-main.ts` |
|---|---|
| `cache.onStatsChanged` → `emitPortEvent(PORT_EVENT.cacheStats)` | Same, written on tag 1 unconditionally; D16's "no port attached" becomes the Go side's "no sink attached" drop |
| `emitPortEvent`'s `activePort` null-guard (D16) | Not needed — there is no port to be absent |
| `attach-port` handling, `activePort?.close()`, `port.start()` | Gone. There is no port; Wails supersedes stream sessions itself (P52 §7.2 "Session lifecycle comes for free") |
| `data.kind === 'req'` on `parentPort` → `handleFrame` → `parentPort.postMessage` | tag 0 → `handleFrame` → tag-0 frame |
| `handleRequest` → `dispatch` → `port.postMessage(response, transfer?)` | tag 1 → `dispatch` → tag-1 frame; `transfer` dropped per `rpc.ts`'s own comment |
| `handleRequest`'s `.catch` synthesising an `ok:false` response | `failure()`, on both channels |
| (nothing) | `console` → stderr (D7), required by the transport |
| (nothing) | `process.parentPort` definition (D6), required by the transport |
| (nothing) | stdin-close / SIGTERM shutdown, stdout backpressure |

**No `uncaughtException` / `unhandledRejection` handler is added**, deliberately: Node's default
already prints the stack to stderr (which the Go host logs under scope `engine`) and exits non-zero
(which fires `E_ENGINE_DOWN` within ~79 ms, P51 part 1). A handler would add a log line the runtime
already writes.

### 4.7 `package.json` — one new script

```
"build:engine": "bunx esbuild src/engine/stdio-main.ts --bundle --platform=node --format=cjs --alias:@shared=./src/shared --external:electron --external:@confluentinc/kafka-javascript --external:ssh2 --external:cpu-features --outfile=shell/runtime/engine/engine.cjs"
```

- The externals are `scripts/run-ipc-backend.sh:30-33`'s verbatim, for the same reasons (native
  addon, optional `ssh2`/`cpu-features` deps).
- `--alias:@shared=./src/shared` is needed because the root `tsconfig.json` carries `"files": []`
  and esbuild will not pick the path mapping up on its own.
- `--format=cjs` matches what `electron.vite.config.ts` already produces for the `engine` entry, so
  the bundling shape is the proven one; `registry.ts`'s per-adapter `await import()` calls stay lazy
  under CJS output.
- Output lands under `shell/runtime/`, which `shell/.gitignore` already ignores (`runtime`).

**This is not `src/`**, so P52's "one new file under `src/`" boundary is intact. It exists because a
file that is only typechecked is not a file anybody has run; §5.4's opt-in test consumes it, and
P56/P57 need it for the real bridge and for packaging anyway.

## 5. Testing plan

Per P52 §13: `go test ./...`, standard-library `testing`, table-driven, `go-cmp` for struct diffs,
tests beside the code, `package enginehost_test` except where the framer's unexported surface is the
subject, real dependencies over mocks — *"EngineHost tests spawn the real vendored `node` against a
real script"* (~line 977). P52 §13's `enginehost` and `bridge/stream` rows are the acceptance
criteria, and every item in both is named below.

**The harness** (`helpers_test.go`):

```go
func nodeBin(t *testing.T) string  // shell/runtime/node/bin/node, else $KIRA_TEST_NODE, else
                                    // exec.LookPath("node"); t.Fatalf naming scripts/vendor-node.sh
func newHost(t *testing.T, script string, args ...string) *enginehost.Host  // t.Cleanup -> Stop()
func captureLogs(t *testing.T) *bytes.Buffer  // slog.SetDefault with a text handler; restores
```

`nodeBin` **fails rather than skips** when no Node is present. P52 §13 rejects a runtime skip that
silently passes; a machine with no `node` cannot run this app at all, so a loud failure naming the
vendor script is the honest outcome.

**The fixture** — `internal/enginehost/testdata/engine-fixture.mjs`, the tagged-protocol successor
to `p51-spike-artifacts/gonode/engine_stub.mjs`. Same framer as §4.5, answering on whichever tag the
request arrived on:

| op | Behaviour |
|---|---|
| `ping` | `{pong:true, enginePid, at}` |
| `echo` | returns `payload` verbatim |
| `raw` | writes a tag-1 frame whose body is the literal bytes of `payload.bytes` (base64), **not** valid JSON — the direct probe for "Go never unmarshals a data frame" |
| `bulk` | a tag-1 frame of `payload.bytes` bytes, deterministic content |
| `slow` | never answers |
| `boom` | `ok:false` with `{message:"synthetic failure", code:"E_SPIKE"}` |
| `bare` | `ok:false` with a message and **no** `code` |
| `crash` | `process.exit(3)` without answering |
| `logline` | writes two lines to stderr, answers `{}` |
| `evt` | writes an unsolicited tag-0 `PortEvent` |
| `badtag` | writes a frame with tag `7`, then a valid tag-0 response |

### 5.1 `frame_test.go` (`package enginehost`)

| Test | Asserts |
|---|---|
| `TestFrameRoundTrip` | Table over `{tag, len}`: `{0,0}`, `{1,1}`, `{0,1024}`, `{1,1<<20}` — `readFrame(bytes.NewReader(encodeFrame(...)))` returns the same tag and a byte-identical body |
| `TestEncodeFrameLayout` | Header is exactly 5 bytes; bytes 0-3 are the **body** length big-endian (not body+1); byte 4 is the tag — the regression guard for §3's choice |
| `TestReadFrameRejectsOversizeLength` | A hand-built header of `maxFrameBytes+1` returns `errFrameTooLarge` and allocates nothing |
| `TestReadFrameHandlesSplitReads` | `iotest.OneByteReader` over three concatenated frames — all three decode |
| `TestReadFrameTruncatedBody` | Header plus a short body returns `io.ErrUnexpectedEOF` |

### 5.2 `host_test.go` (`package enginehost_test`)

| Test | Asserts | §13 row |
|---|---|---|
| `TestCallPingRoundTrip` | `Call("ping", nil)` returns the fixture's payload; `enginePid` equals `host.PID()` | `ping` round trip |
| `TestCallSurfacesStructuredError` | Table: `boom` → `*ipcerr.Error{Code:"E_SPIKE", Message:"synthetic failure"}`; `bare` → `Code:"E_QUERY"` (`engine-host.ts:56`'s default). Also asserts `Error()` is the JSON encoding and carries **no** `[CODE] ` prefix — the §5.3 regression guard | structured error surfacing code+message |
| `TestCallTimeout` | `CallTimeout("slow", nil, 100*time.Millisecond)` → `Code:"E_TIMEOUT"`, message `engine call "slow" timed out`; a subsequent `ping` still answers, proving the pending entry was deleted | per-call timeout |
| `TestTimeoutConstants` | `DefaultTimeout == 30s`, `ConnectTimeout == 20s`; compared against the literals documented from `engine-host.ts:6` and `connections.ts:191/345` | per-call timeout |
| `TestCallOnStoppedHostFailsFast` | `Stop()`, then `Call` → `E_ENGINE_DOWN` in under 1 s (i.e. not via a 30 s timeout) — `engine-host.ts:86-90`'s pre-check | — |
| `TestEngineDownFailsPendingCalls` | Two concurrent calls, one of them `crash`: both return `Code:"E_ENGINE_DOWN"`, message `engine process exited`, within 2 s (P51 measured 79 ms); `Down()` closed; `Alive()` false | `E_ENGINE_DOWN` on mid-call child exit |
| `TestEventFanOutReachesEverySubscriber` | **Two** `Subscribe()` calls; the fixture's `evt` event arrives on **both** with matching topic and payload — the §1.2 regression guard; unsubscribing one leaves the other working | unsolicited event fan-out |
| `TestEngineDownIsPublishedThenChannelsClose` | Each subscriber receives `Event{Topic: EventEngineDown}` as its **last** event, then the channel closes; `Subscribe()` after exit returns an already-closed channel | — |
| `TestStderrIsLoggedLineWise` | With `captureLogs`, the `logline` op produces **two** records, each with `scope=engine`, each carrying one line | §7.3 stderr → logging |
| `TestExitCodeIsLogged` | `crash` (exit 3) produces a `warn` record under scope `engine-host` naming the exit | — |
| `TestUnknownTagDoesNotDesync` | The `badtag` op: the tag-7 frame is skipped and the following tag-0 response still resolves its call (D3) | — |
| `TestConcurrentCallsDoNotInterleaveFrames` | 32 goroutines × `echo` with distinct payloads; every call gets its own payload back — proves `writeMu` + single-`Write` framing (§1.2) | — |

### 5.3 `stream_test.go` (`package enginehost_test`, plus one internal file)

Fakes: `fakeSink` (records frames, configurable to return `ErrStreamFull` for the first N calls, a
non-full error, or to block on a channel).

| Test | Asserts | §13 row |
|---|---|---|
| `TestDataFrameReachesSinkByteIdentical` | `SendData` a 1 MiB request body; the fixture's `echo` on tag 1 returns it; the sink's frame is `bytes.Equal` to what was sent | frame passthrough integrity ≥1 MB |
| `TestDataFrameIsNotUnmarshalled` | The `raw` op returns a tag-1 body that is **not valid JSON** (`\x00\xffnot json`); it arrives at the sink verbatim | *"a data-tagged frame reaching the stream writer byte-identical and without being unmarshalled"* |
| `TestControlAndDataDemux` | A control `ping` and a data `echo` in flight together: the control response resolves `Call` and never reaches the sink; the data response reaches the sink and never resolves a pending call | demux by tag |
| `TestNoSinkDropsDataFrames` | With no sink attached, 200 data frames are consumed and dropped and a subsequent control `ping` still answers — the read loop never stalls (index.ts D16's analogue) | — |
| `TestBackpressureRespectsBothBounds` | A blocking sink; push far more than 64 frames: in-flight queue depth never exceeds `dataQueueFrames` and `queuedBytes` never exceeds `dataQueueBytes`; when the sink unblocks, every frame arrives, in order, none lost | backpressure at the bounded channel |
| `TestSendRetriesOnStreamFull` | A sink returning `ErrStreamFull` five times then succeeding: the frame is delivered exactly once, nothing is dropped, and elapsed time is within the 2→50 ms backoff envelope | — |
| `TestNonFullSinkErrorDetaches` | A sink returning a stand-in for `ErrStreamClosed`: it is called once, then detached; subsequent frames are dropped without stalling the read loop | — |
| `TestSupersededSinkAbandonsRetry` | Sink A blocked-full; `AttachStream(B)`; the in-flight frame is abandoned rather than delivered to B or retried against A forever | — |
| `TestOversizeDataFrameIsDropped` (`package enginehost`, `stream_internal_test.go`) | With `maxDataFrameBytes` lowered to 1 KiB, a 2 KiB data frame never reaches the sink, an `error` record names the size and the limit, and the next frame still flows (D10) | — |

### 5.4 `stdio_main_integration_test.go` — the real `src/engine`, opt-in

One test, `TestStdioMainRealEngineRoundTrip`, which locates `../../runtime/engine/engine.cjs` and
`t.Skip`s with the literal message `run "bun run build:engine" first` when it is absent. This is not
the silent-platform-skip P52 §13 forbids: the bundle is a build product of a command named in §8's
acceptance criteria, and the criteria require the test to have been run green.

It spawns the real bundle under the real Node and asserts:

- **Control tag**: `engine:configure-cache` with `{l2BudgetBytes: 64*1024*1024}` returns `{}` —
  `control.ts`'s `handleConfigureCache`, which touches no adapter, no driver and no database.
- **Control tag**: an unknown op returns `E_UNSUPPORTED` with `control.ts:168`'s message.
- **Data tag**: `ping` returns `{pong:true, enginePid, at}` from `rpc.ts`'s own handler, and
  `enginePid` matches the child's pid.
- **Data tag**: an unknown op returns `E_UNSUPPORTED` with `rpc.ts:66`'s message.
- **Nothing but frames on stdout**: the whole session decodes as a clean frame sequence with no
  trailing bytes — the assertion that D7's console rebind actually works against the real module
  graph.

That is both tag paths, both dispatch tables, and the stdout-purity invariant, against the real
`src/engine`, with no container and no driver.

## 6. Sequencing

Five milestones, each ending at a green `go build ./internal/...` and (from M1) `go test
./internal/enginehost`.

- **M1 — the framer.** `frame.go` + `frame_test.go`; `shell/testdata/engine-ping.mjs` updated to
  the tagged framing plus `engine:configure-cache`; `host.go` switched onto `readFrame`/
  `encodeFrame` with the tag switch. Ends with the app still booting and `EngineService.Status()`
  still answering.
- **M2 — the host.** §1.2's three defects, `Call`/`CallTimeout`, `ipcerr`, the alive pre-check,
  `Subscribe`, the stderr pump, `Stop`'s escalation, the env scrub. `testdata/engine-fixture.mjs`
  and `host_test.go` land with it.
- **M3 — the stream.** `stream.go` + `stream_test.go`.
- **M4 — `config.go`** and its one call from `main.go`.
- **M5 — `src/engine/stdio-main.ts`**, the `build:engine` script, and
  `stdio_main_integration_test.go`. Finish with `gofmt -l shell` (empty), `go vet ./...`,
  `bun run test:go`, `bun run typecheck:node`, `bun run lint`, and one manual
  `bun run build:engine && go test ./internal/enginehost -run TestStdioMainRealEngine -v`.

M1 is the only ordering constraint that matters: the tag byte is a simultaneous change to both ends
of a live wire, and doing it before anything else means every later milestone is tested against the
final framing.

## 7. Scope boundary

**Exactly one new file under `src/`: `src/engine/stdio-main.ts`.** Checked, not assumed:

- **`tsconfig.node.json`** — no change. Its `include` already carries `src/engine/**/*.ts`, and its
  `types: ["node", "electron"]` is what makes the `process.parentPort` property type available for
  D6's cast. `bun run typecheck:node` picks the new file up with no edit.
- **`biome.json`** — no change; `biome check .` covers `src/` already.
- **`electron.vite.config.ts`** — **deliberately** no change. Adding `stdio-main` as a third
  `rollupOptions.input` would ship a file the Electron app never loads. The Electron build must not
  know this file exists.
- **`tsconfig.web.json`, `tests/**`, `playwright.config.ts`, `electron-builder.yml`,
  `vite.wails.config.ts`, `shell/frontend/shim/kira-bridge.ts`** — no change. The renderer's Stream
  wrapper is P56's row.
- **`package.json`** — one added script, `build:engine` (§4.7). No dependency added or removed
  (`esbuild` is already present transitively and already invoked via `bunx` by
  `scripts/run-ipc-backend.sh` and `test:db:kafka`).
- **`src/main/*`, `src/preload/*`, `src/renderer/*`, `src/shared/*`** — no change. In particular
  `src/main/engine-host.ts` keeps running the Electron app unchanged through the coexistence window,
  and `src/main/ipc/engine.ts` (7 lines) and `src/main/engine-config.ts` (33 lines) are **not**
  touched: the former's Go counterpart `bridge/engine.go` already exists and is unchanged here, and
  the latter is *read* as the source of truth for §4.4's Go port while the TS file itself stays live
  until P57 deletes `src/main`.

**Out of scope, by phase**: `bridge.HandleStream` registration, the `wailsSink` adapter, the
renderer's `bridge/port.ts` replacement, `SettingsService.Set` and its cache re-push (D11), the
menu, window bounds, the quit-flush handshake, `navigator.clipboard` — **P56**. `connections`,
`oplog`, `tree`, `secrets`, `preconnect`, `internal/logging` — **P55**; P54 only *emits*
`engine:down` correctly and its consumers do not exist yet, which is why §5.2 asserts delivery and
ordering rather than any downstream effect. Deleting `src/engine/index.ts`, `docs/` updates,
packaging — **P57**.

**No gate.** P52 §15: G1 was the only gate and it passed at 261.7 MB against a ≤ 300 MB threshold.

## 8. Acceptance criteria

1. `bun run test:go` is green, and every item in P52 §13's `enginehost` row — *ping round trip, a
   structured error frame surfacing code+message, unsolicited event fan-out, `E_ENGINE_DOWN` on
   mid-call child exit, per-call timeout, and a data-tagged frame reaching the stream writer
   byte-identical and without being unmarshalled* — has a named test in §5.2/§5.3.
2. P52 §13's `bridge/stream` row — *demux by tag, backpressure at the bounded channel, frame
   passthrough integrity for a ≥1 MB payload* — likewise, in `stream_test.go`.
3. `bun run build:engine` succeeds and
   `go test ./internal/enginehost -run TestStdioMainRealEngine -v` passes against the real bundle
   (recorded in the commit message; the test skips without the bundle).
4. No `fmt.Errorf("[%s] %s"` — or any other `[CODE] message` construction — remains anywhere under
   `shell/`; every `enginehost` error path returns an `*ipcerr.Error` (§5.3's retirement).
5. `git diff --name-only` shows exactly one added file under `src/`
   (`src/engine/stdio-main.ts`), zero modified files under `src/`, and zero changes under `tests/`
   and `scripts/`.
6. `gofmt -l shell` is empty, `go vet ./...` is clean, `bun run typecheck:node` and
   `bun run lint` pass.
7. The Electron app still builds and runs (`bun run build`) — the coexistence rule.
8. The Wails app still builds and boots, `EngineService.Status()` still reports the child alive, and
   the startup `PushCacheConfig` produces no warning against the updated `engine-ping.mjs`.

## 9. Environment notes for the implementing session

- Per `AGENTS.md`'s P52/P53 findings, **a fresh container has none of the toolchain.** This phase is
  almost entirely `./internal/...` work, which needs only the Go toolchain — `enginehost` imports no
  cgo at all. A bare `go build ./...`/`go test ./...` compiles the root `main` package, which imports
  Wails and does need `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`. Prefer
  `go test ./internal/enginehost` for the fast loop.
- **No new Go dependency.** `go-cmp` is already in `go.mod` (`v0.7.0`) and is the only test helper
  used here.
- **Do not add `github.com/wailsapp/wails/v3` to `enginehost`'s imports** (D14). Everything this
  package needs from the Stream is the one-method `Sink` interface; P56 supplies the adapter.
- The authoritative Wails stream source is in the module cache at
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/pkg/application/stream.go`
  (and `stream_transport.go:50` for `streamMaxFrameBytes`). Read it rather than the docs site —
  `wails.io`/`v3.wails.io` are 403-blocked from both of this project's environments.
- `wails3 generate bindings` is **not** needed for this phase: no bound service method's signature
  changes (`EngineService.Status()` is untouched). It *is* needed before the next
  `bun run build:wails`, per `AGENTS.md`'s P53 finding, if the tree is otherwise stale.
- **`AGENTS.md` owes a "P54 implementation findings" entry** on the same pattern as P52's and P53's.
  Two things are already worth writing down before implementation starts, and should be confirmed or
  corrected there: that stdout is the frame channel and therefore `console` must be repointed
  (§1.3), and that `application.StreamConn.Send` blocks while `TrySend` is the `ErrStreamFull`
  variant (§1.4) — P52 §7.2 says the opposite and the next session will otherwise trust it.
