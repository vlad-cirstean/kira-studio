# P11 — gRPC support

> **What this phase is.** `docs/v1.2/SPEC.md`'s P11 row: **browse services/methods (via reflection
> or a supplied `.proto`) and issue unary and streaming gRPC calls, hosted through the same shell.**
> The one non-HTTP protocol in scope for this chapter, landing on the shell, request/response,
> collection, variable and history model every phase before it built.
>
> **What does not land here.** The module rename and package split (P12), the UI-consistency pass
> (P13), the module code review (P14). Also explicitly not here: a raw/frame-level inspector for a
> gRPC call (D14 answers P9 OQ-9 — *absent*, not a degraded `RawExchangePane`), a timing waterfall
> (D14 answers P10 OQ-8 — the mechanism it names does not exist for gRPC, F7), gRPC-Web or Connect
> transports, server-side TLS client certificates, gRPC `auth` beyond metadata, compare-two-calls
> (P8 D12's dialog stays HTTP-only), Postman-format import/export of a gRPC request (F22 — the
> format has no representation for one), and `.proto` *editing* of any kind. Nothing here is
> half-built toward any of them (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not
> half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from P2's/P4's/P8's/P9's/P10's
> prose.** Base: branch `claude/feature-v1-2` at `680d735` (*"docs(architecture): the request
> timeline, what it measures and what falls between phases"*). File:line citations point at that
> content.
>
> **Two of the three preceding phases left this one a written instruction, and one of them is
> wrong.** P9 OQ-9 said a gRPC call *"has no HTTP/1.1 text form at all"* and told P11 to decide
> early whether its own raw view is frame-level or simply absent — D14 decides *absent*, on that
> reasoning. P10 OQ-8 said *"a gRPC call is HTTP/2, so `httptrace` fires the same hooks and F6 says
> they are accurate — the phase collection is directly reusable"*. **It does not, and it is not**
> (F7, measured): `grpc-go` does not use `net/http` at all — it speaks HTTP/2 over a bare
> `net.Conn` through its own `internal/transport`, and `httptrace` is a `net/http` construct.
> `grpc/stats.Handler` is the real equivalent and it reports a different set of facts. Correcting
> that in writing is part of this phase's job.
>
> **The one-sentence design.** One new Go package `internal/grpcclient` resolves a target's service
> and method descriptors from either **server reflection** or a **`protocompile`-compiled `.proto`
> file**, then invokes the chosen method through `grpc.ClientConn.Invoke`/`NewStream` over
> `dynamicpb` messages built from the user's JSON with `protojson` — no generated stubs, no
> code generation step, no `protoc` binary anywhere — with the call itself running as one
> connectionless op on the **existing** scheduler exactly as `HttpService.Send` already does, and
> a streamed message reaching the renderer through one new coalesced push channel.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `go.mod` / `go.sum` | `google.golang.org/grpc`, `google.golang.org/protobuf`, `github.com/bufbuild/protocompile` promoted to direct requirements (D1) |
| `apps/kira-studio/internal/grpcclient/target.go` | **new** — target normalisation and the TLS/plaintext decision (D6) |
| `apps/kira-studio/internal/grpcclient/descriptors.go` | **new** — the two descriptor sources, the per-source private `protoregistry.Files`, the schema projection (D4) |
| `apps/kira-studio/internal/grpcclient/reflect.go` | **new** — the server-reflection client, transitive dependency resolution, v1→v1alpha fallback (D4, F2) |
| `apps/kira-studio/internal/grpcclient/proto.go` | **new** — `protocompile` over a supplied `.proto` plus its import paths (D4, F1) |
| `apps/kira-studio/internal/grpcclient/call.go` | **new** — `Unary`, `ServerStream`, the message codec, the caps, cancellation (D7, D8, D15) |
| `apps/kira-studio/internal/grpcclient/errors.go` | **new** — the `codes.Code` → `ipcerr`-family mapping (D16) |
| `apps/kira-studio/internal/grpcclient/*_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/httpvars/resolve.go` | `Resolver` extracted; `ResolveRequest` reimplemented on it, behaviour-identical (D9, F21) |
| `apps/kira-studio/internal/bridge/grpc.go` | **new** — `GrpcService`: `Describe`, `Call`, `Cancel`-free (D7, D8), the masking checklist (D10) |
| `apps/kira-studio/internal/bridge/events.go` | one new channel constant, `ChannelGrpcCall` (D8) |
| `apps/kira-studio/internal/storage/migrations/0009_p11_grpc.sql` | **new** — `http_items.protocol`, `grpc_call_history` (D11, D12) |
| `apps/kira-studio/internal/storage/model/grpc.go` | **new** — `SavedGrpcRequest`, `GrpcCallHistoryEntry`, `GrpcCallSnapshot` (D5, D11) |
| `apps/kira-studio/internal/storage/model/collections.go` | `CollectionItem.Protocol`; `SavedRequest` untouched (D12) |
| `apps/kira-studio/internal/storage/repos/collections.go` | `protocol` written and projected; `GetGrpcRequest`/`SaveGrpcRequest` (D12) |
| `apps/kira-studio/internal/storage/repos/grpc_history.go` | **new** — `Record`/`List`/`Get`/`Delete`/`Clear`/`Adopt`/`SweepOrphans` (D11) |
| `apps/kira-studio/internal/postman/write.go` | a `protocol='grpc'` item is skipped, and the skip is reported (D12, F22) |
| `apps/kira-studio/internal/storage/model/ops.go`, `packages/shared/domain/ops.ts` | the op kind `'grpc'` |
| `apps/kira-studio/internal/storage/model/tabs.go`, `packages/shared/domain/tabs.ts` | the tab kind `'grpc-request'` (four vocabularies, F17) |
| `apps/kira-studio/main.go` | `GrpcService` registered; `GrpcHistory.SweepOrphans()` beside the existing one |
| `packages/shared/domain/grpc.ts` | **new** — every wire and tab-state shape (D5) |
| `packages/shared/domain/collections.ts` | `CollectionItemSummary.protocol`; `httpSavedGrpcRequestSchema` (D12) |
| `packages/shared/protocol/events.ts` | the `grpcCall` channel name |
| `apps/kira-studio/frontend/src/bridge/control.ts` | `grpcDescribe`, `grpcCall`, `onGrpcCall`, four history wrappers |
| `apps/kira-studio/frontend/src/state/tabKinds.ts`, `workbench/tabViews.ts` | the `'grpc-request'` registry entries |
| `apps/kira-studio/frontend/src/views/grpcrequest/**` | **new** — the view, the method browser, the message editor, the response pane (D13, D14) |
| `apps/kira-studio/frontend/src/http/grpc/target.ts` | **new** — the renderer's own target/method formatting, shared by the tree row and the view (F18) |
| `apps/kira-studio/frontend/src/http/state/collections.ts`, `CollectionRow.vue`, `menus.ts`, `HttpStart.vue` | a gRPC request is a first-class row and a first-class "New…" action (D12) |
| `apps/kira-studio/tests/ui/grpc-request.spec.ts` | **new** — §6.4 |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | one `emitWailsEvent` helper (F20) and the new FQN entries |
| `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts` | the two widened vocabularies |
| `docs/ARCHITECTURE.md` | the gRPC paragraph, the dependency row, the two corrected forward pointers |
| `AGENTS.md` | nothing — no new environment fact (§3) |

### 0.2 Out of scope, explicitly

- **P12–P14's own rows**, listed in the header blockquote.
- **Any change to the HTTP path.** `internal/httpclient` is byte-identical after this phase;
  `bridge/http.go` changes only where `httpvars.ResolveRequest`'s internals move under it (D9,
  behaviour-identical, pinned by its existing tests passing unedited). §6.6 makes this a diff
  check.
- **A raw/frame inspector.** D14, answering P9 OQ-9. A gRPC exchange's wire form is HPACK-encoded
  HTTP/2 frames carrying length-prefixed protobuf; there is no text rendering that is not a
  fabrication, and `grpc-go` exposes no hook that would yield the bytes without forking the
  transport. The message list *is* the honest view.
- **A timing waterfall.** D14, answering (and correcting) P10 OQ-8. F7 measures that `httptrace`
  fires nothing for a gRPC call. `stats.Handler` would give per-message timings and one
  connection-establishment bracket — genuinely useful, genuinely a different design from
  `TimelinePane.vue`'s hop waterfall, and genuinely not what this row asks for. OQ-3.
- **Client-streaming and bidirectional-streaming *calls*.** D8 ships unary and server-streaming,
  which is what the SPEC row's *"unary and streaming"* asks for at minimum; F5 verifies all four
  work through the identical primitives, and D8 states exactly what a later phase has to add
  (a send-more-messages affordance and a half-closed state, both renderer work). OQ-1.
- **gRPC-Web, Connect, or any non-`h2` transport.** A separate protocol family; the SPEC's chapter
  intro scopes this chapter to *"HTTP and gRPC only"*.
- **`.proto` authoring, validation-as-you-type, or a bundled well-known-type editor.** A `.proto`
  is an input file chosen with the existing picker, read by Go, and never written.
- **A descriptor set persisted to `kira.sqlite`.** D4: descriptors are derived data, are large, and
  go stale. A saved gRPC request stores what the user typed, never a compiled schema. OQ-2.
- **`InsecureSkipVerify` / "trust this certificate once".** D6 — P2 D4 states *"TLS verification is
  always on … with no per-request opt-out"* and this phase does not open the first hole in it.
  A plaintext toggle and an optional CA-certificate file cover the two real cases. OQ-4.
- **Compression, keepalive tuning, retry policy, load-balancing config, service config.**
  `grpc-go`'s defaults, unmodified — the same posture `httpclient`'s one `*http.Transport` takes.
- **Compare two gRPC calls.** P8 D12's dialog is built on two `httpclient.Response` objects. OQ-6.

### 0.3 Ground rules

- **A secret's plaintext must never reach `kira.sqlite` outside `http_variables.secret_value`, and
  must not reach a copyable surface ungated.** P5 D6/F3 drew the first line, P7 D10 and P9 D6 the
  second, P10 D14 widened it to four fields. gRPC adds three new carriers — the target, request
  **metadata** (`authorization: Bearer {{token}}` is the single most likely place a secret appears
  in this whole feature), and the request message JSON — plus a fourth nobody would look for: the
  **reflection call itself** sends the same resolved metadata. D10 is the checklist.
- **Go owns the network; only a path ever crosses the bridge, never a file's bytes.**
  `docs/ARCHITECTURE.md`'s own invariant, and P4 D11/F16's rule for import/export. A `.proto` file
  is chosen by `FilesService.ChooseOpen` and read by Go.
- **The renderer never parses a wire protocol** (`docs/ARCHITECTURE.md`'s Invariants). Protobuf
  descriptors, dynamic messages and the gRPC framing all stay in Go; the renderer sees JSON text
  and a projected schema.
- **`http/**` may not import `views/**` or `project/**`** (`biome.json:126-149`, P1 D7);
  **`views/<kind>/**` may not import another `views/<kind>/**`** (`biome.json:65-105`). F18 decides
  every placement question in this phase from those two rules, including the one that would
  otherwise be tempting (reaching into `views/httprequest/` for a shared pane).
- **A new tab kind costs four hand-maintained vocabularies, one of which no compiler guards.**
  P2 F1/D10. `tests/unit/go-ts-vocabulary-parity.spec.ts` is that guard and it is extended here,
  not bypassed.
- **Nothing this phase adds may be able to fail an HTTP send, a Studio query, or a startup.**
  A descriptor fetch, a `.proto` compile and a gRPC call are all reachable only from a gRPC tab;
  the migration adds one column with a default and one new table.

---

## 1. What the code does today

### 1.1 Http mode has exactly one tab kind, and the registry was built for a second

`packages/shared/domain/tabs.ts:7-51`: `tabKindSchema` has eight members, `RENDERABLE_TAB_KINDS`
lists the same eight, and `TAB_KIND_MODE` maps seven to `'studio'` and `'http-request'` to
`'http'`. `state/tabKinds.ts:208-240` is the `'http-request'` registry entry; `workbench/tabViews.ts:16-25`
is its component half. `docs/ARCHITECTURE.md`'s UI-architecture section states the promise plainly:

> *"Adding a tab kind means one registry entry each in `state/tabKinds.ts` and
> `workbench/tabViews.ts`, not editing a dispatch chain in three files — `'http-request'` (P2) is
> the first kind to actually exercise that promise."*

`'grpc-request'` is the second, and it is the first that shares a *mode* with an existing kind
rather than introducing one.

### 1.2 The send path: two-stage substitution, one op, one bound call

`views/httprequest/state.ts:161-229`'s `send()` is stage 1 — it resolves every non-secret and every
`{{$dynamic}}` reference in the renderer and hands `control.httpSend` the partly-resolved request
plus `collectionId`/`environmentId`. `bridge/http.go:59-139` is stage 2: inside
`Host.RunOp(ctx, OpSpec{ConnectionID: nil, Kind: "http", …})` it calls `op.SetCommand` with the
**unresolved** URL, then `HttpVars.ResolveRequest`, then `httpclient.Send`, then masks the result
back to `{{name}}` form (`maskSecrets`, `:169-190`) before recording history.

The ordering comment at `bridge/http.go:72-76` is the rule this phase inherits verbatim:

> *"`op.SetCommand` is called with the *unresolved* URL, both times — `op_log.command` is a
> persisted SQLite column rendered in the Operations panel, and a `{{token}}` in a URL is exactly
> the kind of thing a user puts a credential in."*

### 1.3 Collections store a request as one document, keyed by a folder/request kind

`migrations/0006_p4_collections.sql`: `http_items(id, collection_id, parent_id, kind, name,
sort_order, method, url, request_json, origin_json, …)`. `kind` is `'folder' | 'request'`
(`model/collections.go:31-39`), `method`/`url` are denormalised so the tree renders a chip and
searches without reading a body, and `request_json` holds `model.SavedRequest`
(`model/collections.go:50-63`) — *"deliberately field-identical to the request half of
`httpRequestTabStateSchema`"*.

Two structural facts matter here. `kind` is load-bearing for **tree structure**, not for request
flavour: `http/state/collections.ts:151` computes `hasChildren` from `item.kind === 'folder'` and
`CollectionsTree.vue:60-67`'s `onOpen` branches on `row.kind !== 'request'`. And **export starts
from `origin_json`** (`docs/ARCHITECTURE.md`'s Storage section), rewriting only `url`/`header`/
`body` — a row with no Postman origin at all has never existed except for rows this app created,
which the writer emits from `request_json`.

### 1.4 Response history is HTTP-shaped from the column list down

`migrations/0008_p8_response_history.sql` names its columns `method, url, environment, status,
status_text, elapsed_ms, body_bytes, stored_bytes, snapshot_json`, and `repos/response_history.go:36-42`'s
`storedSnapshot` embeds `httpclient.Response` by value. `ResponseHistoryEntry.status` reaches the
renderer as an HTTP status and is rendered through `statusClass()` (`packages/shared/domain/http.ts:383-388`),
which answers `'err'` for anything below 100 — including `0`, which is gRPC's `OK`. F19.

What *is* reusable, and is reused conceptually rather than by import: the `scope_key` generated
column, the three caps, `SweepOrphans` and `Adopt` (D11).

### 1.5 Nothing in the repo speaks HTTP/2 framing, protobuf, or a push channel for a long-running call

`go.mod` has no `google.golang.org/grpc`, no `google.golang.org/protobuf` — not even indirectly;
`grep -n "google.golang.org/\(grpc\|protobuf\)" go.sum` returns nothing. `internal/httpclient` is
`net/http` and, since P10, `net/http/httptrace`.

For push there is exactly one mechanism: `appcore.Emitter` (`internal/appcore/deps.go:16-28`) with
`Emit`/`EmitTo`/`EmitFocused`, consumed only by `bridge/events.go`. Its two continuous producers
are `ChannelOpUpdate` (per-op) and `ChannelAppMetrics` (a ticker). No bound service emits today.

### 1.6 The three preceding phases each left this one a written instruction

- **P5 §8 OQ-8** re-handed the per-mode left-panel width and named *"P11's gRPC service/method
  browser"* as the likely trigger. D13 puts the browser inside the tab, not the panel, so the
  trigger still does not fire — stated so it is not re-deferred silently a third time.
- **P9 §8 OQ-9** — quoted in the header blockquote. Answered by D14.
- **P10 §8 OQ-8** — quoted in the header blockquote. **Corrected** by F7 and answered by D14.

---

## 2. Findings

Every finding marked *"verified by running it"* comes from a throwaway Go module (four programs,
deleted before commit) built against `google.golang.org/grpc v1.83.2`,
`google.golang.org/protobuf v1.36.12` and `github.com/bufbuild/protocompile v0.14.1`. It compiled a
real `.proto` at runtime, registered a service on a real `grpc.Server` from the compiled descriptor
with **no generated code of any kind**, and drove it over loopback, over TLS, and through a real
CONNECT proxy.

### F1 — *Verified by running it*: `protocompile` compiles a real `.proto`, imports included, with no `protoc` binary
A five-method service importing `google/protobuf/timestamp.proto`:

```
== protocompile: compiled echo.proto, package=kira.probe.v1, services=1, imports=1
   kira.probe.v1.Echo.Unary         client_stream=false server_stream=false in=…EchoRequest out=…EchoResponse
   kira.probe.v1.Echo.ServerStream  client_stream=false server_stream=true  …
   kira.probe.v1.Echo.ClientStream  client_stream=true  server_stream=false …
   kira.probe.v1.Echo.Bidi          client_stream=true  server_stream=true  …
```

`protocompile.WithStandardImports(&protocompile.SourceResolver{ImportPaths: …})` resolves the
well-known types from the `protobuf` module's own embedded copies, so a user's `.proto` that
imports `timestamp`/`duration`/`struct`/`empty`/`any`/`wrappers` compiles with nothing installed.
The result is a plain `protoreflect.FileDescriptor` — the same interface reflection produces (F2),
which is what lets D4 have **one** descriptor abstraction rather than two.

Error quality was measured too, because a bad `.proto` is the common case while someone is wiring
one up:

```
== protocompile error: broken.proto:2:8: open /tmp/nope/missing.proto: no such file or directory
```

`file:line:col`, and the first error rather than a cascade. That is directly renderable (D17).

### F2 — *Verified by running it*: server reflection needs no third-party library, and the hand-rolled client is ~110 lines
Two routes were built and run against the same server.

**Route A, `github.com/jhump/protoreflect/grpcreflect`:** `grpcreflect.NewClientAuto(ctx, conn)` +
`ListServices()` + `ResolveService(name)`, about 6 lines, and it negotiates v1/v1alpha itself.

**Route B, `google.golang.org/grpc/reflection/grpc_reflection_v1`'s own generated client:**
`ServerReflectionInfo` is a bidi stream; `ListServices` and `FileContainingSymbol` are two request
variants; each response carries serialised `FileDescriptorProto`s which `protodesc.NewFile` links
into a `protoregistry.Files`. Measured output:

```
   service: grpc.reflection.v1.ServerReflection
   service: grpc.reflection.v1alpha.ServerReflection
   service: kira.probe.v1.Echo
== hand-rolled reflection: kira.probe.v1.Echo, 5 methods; deps fetched=2
   Unary        in=…EchoRequest(3 fields) out=…EchoResponse cs=false ss=false
   ServerStream in=…EchoRequest(3 fields) out=…EchoResponse cs=false ss=true
   …
```

Two facts from that run. `grpc-go`'s reflection server **already returns the transitive
dependencies** in one response (`deps fetched=2` from a single `FileContainingSymbol`) — but the
protocol does not require it, so the recursive `FileByFilename` fallback is still needed for
other implementations, and it is what the `link` closure in the probe (≈30 of the 110 lines) does.
D1 chooses Route B on F3's grounds.

### F3 — `jhump/protoreflect v1.18.1` drags in the deprecated `github.com/golang/protobuf`, and a beta of its own v2
`go get github.com/jhump/protoreflect/grpcreflect@v1.18.1` resolved:

```
go: downloading github.com/golang/protobuf v1.5.4
go: downloading github.com/jhump/protoreflect/v2 v2.0.0-beta.1
```

`grpcreflect/client.go:17` imports `github.com/golang/protobuf/proto` — the **deprecated** APIv1
module — and `desc/sourceinfo/registry.go:40` imports `jhump/protoreflect/v2/sourceinfo`, i.e. a
**beta** of the library's own successor. Both would become transitive requirements of the product
binary. That is the requirement Route B meets and Route A does not: *no deprecated module, no beta
module, and no dependency the Go team is not already shipping*. D1.

### F4 — *Verified by running it*: `dynamicpb` + `protojson` is the whole request/response codec, and its strictness is exactly right for a request builder
```
== unary ok in 396.691µs: {"text":"hi|token=s3cret"}
== protojson unknown field (default):        proto: (line 1:13): unknown field "nope"
== protojson unknown field (DiscardUnknown): <nil>
== protojson bad type: proto: (line 1:10): invalid value for int32 field count: "not-a-number"
== protojson default:         {"text":"hi"}
== protojson EmitUnpopulated: { "text": "hi", "index": 0 }
```

Three design consequences, all decided in D5/D17:

- **Unknown-field rejection is on by default and stays on for the *request*** — a typo'd field name
  in a request the user is authoring must be an error, not a silently dropped field, and the error
  carries `line:col`.
- **`DiscardUnknown` is on for the *response*** — a server running a newer schema than the `.proto`
  the user supplied must not make its own answer unreadable.
- **`EmitUnpopulated` is the response rendering default**, because a proto3 scalar at its zero value
  is *absent* from default `protojson` output, and "the field is missing" versus "the field is 0" is
  precisely the question a person opens a gRPC client to answer.

### F5 — *Verified by running it*: all four call shapes work through two primitives and no generated stubs
`conn.Invoke(ctx, "/pkg.Service/Method", in, out, grpc.Header(&h), grpc.Trailer(&t))` for unary, and
`conn.NewStream(ctx, &grpc.StreamDesc{ClientStreams:…, ServerStreams:…}, "/pkg.Service/Method")` for
every streaming shape. Measured:

```
== server stream header: map[content-type:[application/grpc] x-kira-response:[stream]]
   [  0.03ms] {"text":"msg-0"}
   [ 20.44ms] {"text":"msg-1","index":1}
   [ 41.19ms] {"text":"msg-2","index":2}
== server stream messages: 3 trailer: map[x-kira-trailer:[stream-done]]
== client stream: {"text":"received 4"}
== bidi messages: 3
```

The per-message arrival offsets are real — the server slept 20 ms between sends and the client saw
them 20 ms apart, which is the property a streaming view exists to show. **Client-streaming and
bidi work through the identical primitives**, so D8's decision to ship only unary + server-streaming
is a *scope* decision about the UI, not a capability limit; OQ-1 records exactly what is left.

### F6 — *Verified by running it*: metadata crosses in both directions, headers and trailers are separate, and an illegal key fails locally
```
   header=map[content-type:[application/grpc] x-kira-response:[hello]]  trailer=map[x-kira-trailer:[bye]]
== metadata.New lowercases: map[x-upper:[v]]
== invalid metadata key: code=Internal err=… header key "bad key" contains illegal characters not in [0-9a-z-_.]
== non-ascii value on a non -bin key: code=OK err=<nil>
```

Four consequences. **Header and trailer metadata are distinct and both are worth showing** (a gRPC
server commonly puts its real error detail in a trailer). **Keys are lowercased**, so the UI must
not promise case preservation. **An illegal key is rejected by the client library with
`codes.Internal`**, not by the server — so D17 gives it its own sentence rather than letting a
typo read as a server fault. And a `-bin`-suffixed key is the protocol's own binary-value escape
hatch, which this phase does not surface (OQ-5).

### F7 — *Verified by running it, and the decisive correction*: `httptrace` fires **nothing** for a gRPC call
A full `httptrace.ClientTrace` (`DNSStart`, `ConnectStart`, `GotConn`, `GotFirstResponseByte`) was
installed on the context of every call in the probe — unary, all three streaming shapes, and the
reflection stream. Result:

```
== httptrace hooks fired for any gRPC call: false
```

`grpc-go` dials a `net.Conn` and runs its own HTTP/2 client in `internal/transport`; it never
constructs an `*http.Request` and never goes through `net/http`'s transport, which is the only thing
that reads a `ClientTrace` off a context. **P10 OQ-8's premise is therefore wrong**, and a plan that
inherited it would have shipped a timeline pane that renders nothing.

The real equivalent is `grpc.WithStatsHandler`, and the same probe recorded exactly what it gives:

```
*stats.Begin / *stats.ConnBegin / *stats.DelayedPickComplete / *stats.OutHeader
OutPayload wire=19 len=14 / *stats.InHeader / InPayload wire=12 len=7 / InPayload wire=14 len=9 …
*stats.InTrailer / End begin=20:58:50.558 end=20:58:50.620 err=<nil>
```

Per-message wire and decoded lengths, header/trailer boundaries, and a begin/end bracket — but **no
DNS, connect or TLS-handshake split at all** (`ConnBegin`/`ConnEnd` bracket the whole connection).
So the five-phase model `TimelinePane.vue` draws has no counterpart here, which is a second,
independent reason D14 declines to reuse it. What `stats.Handler` *would* support is a per-message
timeline — D8 takes the one field from it that the message list needs (arrival offset and wire
size), computed directly in `call.go` rather than through a handler, and OQ-3 hands the rest on.

### F8 — *Verified by running it*: cancellation and deadline both work, mid-stream, with distinct codes
```
== cancel after 5 msgs -> err=rpc error: code = Canceled desc = context canceled   code=Canceled
== deadline: code=DeadlineExceeded(4) err=rpc error: code = DeadlineExceeded desc = context deadline exceeded
```

Cancelling the call context mid-server-stream ends the stream at the next `RecvMsg` with
`codes.Canceled`, and the five messages already delivered stay delivered. That is exactly the
`Host.RunOp`-derived-context shape `bridge/http.go` already relies on (`RunOp` cancels the derived
context, `OpsService.Cancel` is the trigger), so **the Stop button works for a stream with no new
cancellation mechanism** (D8), and a partial result is a real, keepable result rather than a
discarded one.

### F9 — *Verified by running it*: the default receive cap is 4 MiB, and exceeding it is a legible error
```
== 5 MiB message, default cap:  code=ResourceExhausted err=… grpc: received message larger than max (5242885 vs. 4194304)
== 5 MiB message, 16 MiB cap:   err=<nil> len=5242880
```

`grpc.MaxCallRecvMsgSize` is a per-call option. D15 raises it deliberately and states the number,
rather than leaving a 4 MiB surprise that reads as a server fault — the same posture
`httpclient`'s own `maxResponseBytes = 10 MiB` takes, with the same "report the truncation, never
hide it" rule.

### F10 — *Verified by running it*: the four TLS outcomes, and what each one's failure text actually says
Against a self-signed TLS server:

```
== TLS w/ correct root:        <nil>
== TLS w/ system roots:        code=Unavailable … "transport: authentication handshake failed: tls: failed to verify certificate: x509: certificate …"
== TLS w/ InsecureSkipVerify:  <nil>
== plaintext vs TLS server:    code=Unavailable … "error reading server preface: EOF"
```

The last line is the one that earns a sentence in the UI (D17): *"error reading server preface:
EOF"* is what a user sees when they forget the TLS toggle, and it is completely opaque. Every one
of these arrives as `codes.Unavailable`, which is why D16 does not map `Unavailable` to a single
message.

### F11 — *Verified by running it*: a server without reflection answers `Unimplemented`, precisely
```
== reflection absent: code=Unimplemented err=… unknown service grpc.reflection.v1.ServerReflection
```

Distinguishable from every other failure by code alone, which is what lets D17 say *"this server
does not expose reflection — supply a `.proto` file instead"* rather than *"call failed"*.

### F12 — *Verified by running it*: a scheme-prefixed target is silently misparsed, and the error names a port nobody typed
```
127.0.0.1:1            code=Unavailable  … dial tcp 127.0.0.1:1: connect: connection refused
https://127.0.0.1:1    code=Unavailable  … invalid target address https://127.0.0.1:1, error info: address https://127.0.0.1:1:443: too many colons in address
http://127.0.0.1:1     code=Unavailable  … (identical)
grpc://127.0.0.1:1     code=Unavailable  … (identical)
dns:///127.0.0.1:1     code=Unavailable  … dial tcp 127.0.0.1:1: connect: connection refused
unix:///tmp/nope.sock  code=Unavailable  … dial unix /tmp/nope.sock: connect: no such file or directory
127.0.0.1:1/some/path  code=Unavailable  … dial tcp: lookup tcp/1/some/path: unknown port
""                     code=Unavailable  … delegating_resolver: invalid target address "": missing address
```

A gRPC target is **not a URL**: a leading `scheme://` is either a *resolver* scheme (`dns:`,
`unix:`, `passthrough:` — the two shown work) or, for anything else, part of the host, which then
gets `:443` appended and fails with *"too many colons"*. Anyone arriving from the HTTP tab next
door will type `https://api.example.com`, and P2 D4's own URL handling actively teaches them to
(*"a URL with no scheme resolves to `https://`"*). **D6 normalises before dialling** — strip a
recognised web scheme and let it set the TLS toggle, refuse a path or a query, require a host —
and every one of these strings is a case in the normaliser's test.

### F13 — *Verified by running it, incidentally*: `grpc-go` honours `HTTPS_PROXY`/`NO_PROXY`
The first run of F12 (before `NO_PROXY=*` was set) failed the scheme-prefixed targets with
*"failed to do connect handshake"* rather than *"too many colons"* — this sandbox exports
`HTTPS_PROXY=http://127.0.0.1:33383`, and `grpc-go`'s `internal/resolver/delegatingresolver`
consults `ProxyFromEnvironment` exactly as `httpclient`'s own transport does
(`internal/httpclient/client.go:45-50`). So a proxied user gets the same behaviour on both tabs
with no configuration, `grpc.WithNoProxy()` is the opt-out if one is ever wanted, and this is
recorded so a future *"why did my gRPC call go somewhere else"* is not mistaken for a bug.

### F14 — *Verified by running it*: `protoregistry.GlobalFiles` **panics** on a duplicate path; a private `*Files` returns an error
```
== GlobalFiles second registration: proto: file "echo.proto" is already registered
== two private registries, same path: ok
```

`protoregistry/registry.go:42-65` sets `conflictPolicy = "panic"` and `(*Files).RegisterFile`
(`:113-131`) applies it **only when `r == GlobalFiles`**; a private registry returns the error
instead. Two users' `.proto` files both declaring `package api.v1`, or the same file loaded twice
after an edit, are *ordinary* situations for this feature. **So `internal/grpcclient` must never
touch `protoregistry.GlobalFiles`**, and every descriptor source gets its own `*protoregistry.Files`
(D4). This is a crash the app would otherwise take, in a package the user can point at any file on
disk — recorded as a finding rather than a footnote for that reason.

### F15 — The dependency costs about what the app's five biggest existing drivers cost together
Measured by building minimal programs that reference each set and comparing against a 1,567,367-byte
`println` baseline, all `linux/amd64`, no flags:

| binary | size | over baseline | packages |
|---|---|---|---|
| baseline (`println`) | 1,567,367 | — | — |
| `grpc` + `protobuf` (`dynamicpb`, `protojson`, `protodesc`, reflection client) | 15,802,159 | **≈14.2 MB** | 311 |
| `pgx` + `mongo-driver/v2` + `aws-sdk s3` + `aws-sdk sqs` + `franz-go` (five drivers already shipped) | 15,082,390 | ≈13.5 MB | 387 |

So this is the largest single dependency addition the app has taken — and it is the *same order* as
what is already linked in for the database side, in a binary that already links ten adapters.
`AGENTS.md` requires naming the cost rather than discovering it; §6.1 makes the packaged-app size
delta an explicit check, and OQ-7 records the one lever if it ever matters (`protocompile` is only
needed for the `.proto` source path and is ~1 MB of the total; the rest is not separable).

Licences, checked at package level: `grpc-go` Apache-2.0, `protobuf-go` BSD-3-Clause,
`protocompile` Apache-2.0. All fully open source with no gated tier — `AGENTS.md`'s own rule.

### F16 — *Verified by running it*: `grpc.NewClient` is lazy, which is what makes a per-call connection affordable
```
== grpc.NewClient to a dead port returned in 34.547µs, state=IDLE
== dead-port invoke: code=Unavailable … dial tcp 127.0.0.1:1: connect: connection refused
```

`NewClient` builds a `*grpc.ClientConn` without dialling; the connection happens on the first RPC.
So constructing one per call costs microseconds plus the connection the call needs anyway, and
D7 can take the simple, obviously-correct option (one `ClientConn` per call, closed with the call)
instead of a pooled client keyed on a target-plus-TLS-settings tuple — which would have to be keyed
on the *resolved* target, i.e. on a string that can contain a secret (§0.3). OQ-8 records what
reuse would buy if a future phase wants it.

### F17 — The tab-kind cost is four vocabularies, three of which the compiler checks
P2 F1, still exactly true: `tabKindSchema` (`domain/tabs.ts:7-19`), `RENDERABLE_TAB_KINDS` (`:26-35`)
and `tabRecordSchema`'s discriminated union (`:183-220`) are all compiler-checked through
`TAB_KINDS`' `{ [K in TabKind]: TabKindDef<K> }` and `TAB_VIEWS`' `Record<TabKind, Component>`;
Go's `model.RenderableTabKinds` (`model/tabs.go:26-32`) is not, and a missing entry there silently
drops the tab on restore. `tests/unit/go-ts-vocabulary-parity.spec.ts` reads the Go source as text
and is the only guard. The op kind adds a fifth list with the same split (`model/ops.go:36-43` vs
`domain/ops.ts:3-21`), also guarded there.

### F18 — The import rules decide every placement question, including the tempting one
- `views/grpcrequest/**` may not import `views/httprequest/**` (`biome.json:79-98`). So the gRPC
  response pane cannot reuse `ResponsePane.vue`, `RawExchangePane.vue` or `TimelinePane.vue` **even
  if it wanted to** — which happens to agree with D14's independent reasoning, and is worth stating
  because it removes the temptation to widen a shared pane with a protocol prop.
- `http/**` may not import `views/**` (`biome.json:126-149`). So anything both the collections tree
  row and the gRPC view need — target/method formatting, the streaming-kind chip class — lives in
  `http/grpc/` or in `packages/shared/domain/grpc.ts`, never in `views/grpcrequest/`. This is P4
  D16's own reasoning for why `httpMethodClass` lives in the shared domain rather than the view.
- `state/**` may not import `workbench/**` (P1 F19), which is why the registry stays split across
  `state/tabKinds.ts` and `workbench/tabViews.ts`. Unchanged.

### F19 — Reusing `http_response_history` would require a discriminator, a union snapshot, and a shared status field that means two things
Concretely, against `migrations/0008_p8_response_history.sql` and `repos/response_history.go`:

- `status INTEGER NOT NULL` would hold an HTTP status for one protocol and a `codes.Code` for the
  other — and `statusClass(0)` returns `'err'` (`domain/http.ts:383-388`) for gRPC's `OK`.
  Every consumer of `ResponseHistoryEntry` would need a protocol branch.
- `storedSnapshot` (`repos/response_history.go:36-42`) embeds `httpclient.Response` **by value**.
  Making it a union means either two nullable members or a `json.RawMessage` — and `Get`
  deliberately *reports* a decode failure rather than blanking the row (`:256-259`), which a union
  makes strictly more fragile.
- `body_bytes`/the 256 KiB per-entry body cap have no equivalent for a call whose payload is *N*
  messages; a message-count cap is a fourth cap the HTTP table has no reason to carry.
- What is genuinely shared is *SQL discipline*, not schema: `scope_key GENERATED ALWAYS AS
  (COALESCE(item_id, 'tab:' || tab_id)) VIRTUAL`, the insert-then-trim, the window-function byte
  sweep, `Adopt`, `SweepOrphans`. All five are patterns already applied twice in this repo
  (`filter_history`, `http_variable_history`, `http_response_history`), so applying them a fourth
  time is following a precedent, not duplicating an abstraction that exists.

D11 decides on this.

### F20 — There is no way for a `tests/ui` spec to deliver a pushed event today, and the fix is five lines
`tests/ui/support/mockRuntime.ts` intercepts `$Call.ByName` bound calls (`CHANNEL_TO_FQN`,
`:113-125`) and has **no** emit path: `grep -n "Emit\|dispatchWailsEvent" mockRuntime.ts` returns
nothing, and no existing spec drives `onOpUpdate` or `onConnectionState`.

But the tier serves the **real** Wails runtime bundle (`:12-30`, resolved through `go list -m`), and
that bundle exposes `window._wails.dispatchWailsEvent` — confirmed by string-searching
`…/wails/v3@v3.0.0-beta.16/internal/assetserver/bundledassets/runtime.js`, which lists
`_wails.dispatchWailsEvent` alongside `_wails.invoke`. So one exported helper
(`emitWailsEvent(page, name, data)` → `page.evaluate`) makes D8's push channel drivable from a
spec, with no stand-in for the runtime's own dispatch.

### F21 — `httpvars` already contains the reusable half; only its signature is HTTP-shaped
`internal/httpvars/resolve.go` is two layers. `Resolve(text, values, secretNames)` (`:41-88`) and
`Names(text)` (`:93-117`) are **pure, protocol-free** and are the two-token grammar pinned against
the renderer's own `substitute.ts` by `testdata/substitution.json`. `(*Service).ResolveRequest`
(`:161-238`) is the HTTP-typed wrapper: it takes `(url, []httpclient.Header, httpclient.Body, …)`,
fetches secrets via `s.deps.Repo.SecretsFor`, walks the fields, and accumulates
`used map[string]string` for P9 D6's masking replacer.

The `used` accumulation and the `SecretsFor`-plus-short-circuit preamble are the parts a second
protocol needs verbatim. Extracting them as a `Resolver` (D9) is a **behaviour-preserving**
refactor with a real second consumer — which is exactly the situation `docs/v1.2/SPEC.md`'s
module-boundary section says to resolve by extraction rather than duplication.

### F22 — Postman Collection v2.1 has no representation for a gRPC request
The published v2.1 schema's `item.request` is HTTP-shaped (`method`, `url`, `header`, `body`,
`auth`); Postman's own gRPC requests live in its cloud format, not in a v2.1 export.
`internal/postman/write.go` therefore has nothing faithful to emit for one. D12 skips such items and
**reports the skip** in `ExportReport`, matching P4 D12's own rule that *"every warning kind is a
case where the app quietly does something other than what the file says, and the alternative to
telling the user is letting them find out"* — silently dropping requests from an export would be
the worst possible reading of "faithful round-trip".

### F23 — *Verified safe*: every surface this phase draws already has its primitive, and no new colour token is needed
`ViewChrome`, `SegmentedControl`, `PanelSplitter`, `TextField`, `AppButton`, `IconButton`,
`MessageStrip`, `EmptyState`, `VirtualList`, `CodeMirrorHost`, `DialogFrame`, `PopoverPanel`,
`AutocompleteField` are all in `theme/primitives/`. `.p-chip` already carries `ok`/`warn`/`err`/
`info` (P2 F17), which is all the streaming-kind and status-code chips need. `formatBytes`
(`format.ts`) and `RunState.vue`'s ms/s convention (P10 F18) are the two formatters.
`AutocompleteField.vue` — built for the connection dialog — is the right shape for the
method picker's type-ahead, so the browser needs no new primitive either. **`primitives.css` and
`tokens.css` are untouched.**

---

## 3. Checked, and not fired

- **No change to `internal/httpclient`.** Not one line. §6.6 is a `git diff` check.
- **No change to `sharedClient`, the HTTP transport, or `httptrace`** — F7 means there is nothing
  to share even if it were wanted.
- **No new mode.** `TAB_KIND_MODE['grpc-request'] = 'http'` (D2) — the SPEC's *"hosted through the
  same shell"* is satisfied by a second kind inside the existing mode, not a third mode tab.
- **No new left panel and no per-mode panel width.** D13 puts the service/method browser inside the
  tab; P5 OQ-8's named trigger does not fire (§1.6).
- **No `protoc`, no `buf`, no code generation, and no build step.** `protocompile` is a library
  (F1); the only `.pb.go` files linked are the ones `grpc-go` ships for its own reflection service.
- **No `protoregistry.GlobalFiles` use anywhere** (F14). §6.6 makes it a grep check.
- **No `NOTICES.md` change** — that file is scoped to bundled *icon assets* (`NOTICES.md:1-3`), and
  this phase adds no asset.
- **No new lazy renderer chunk.** Nothing new is `await import()`ed; `docs/ARCHITECTURE.md:28`'s
  four chunks stay four (§6.1).
- **No `theme/primitives/` addition and no CSS-token change** (F23).
- **No change to P8's three caps, `http_response_history`, or any existing migration.** The new
  migration adds one defaulted column and one table (D11, D12).
- **No new shortcut, accelerator, or `menutemplate.go` change.** `view.run`/`view.refresh` already
  route to whichever view registered them (P2 F15); the gRPC view registers `view.run` as Call.
- **No second reveal gate.** A gRPC request never renders a secret's substituted value (D10) —
  there is no *Copy as curl* equivalent here — so P9 OQ-4's duplication is not extended.
- **No `packages/shared/protocol/wire.fbs` change.** The data plane is the adapters'; a gRPC message
  is control-plane JSON, not a bulk page (D8).
- **No `docs/PERF.md` budget.** Nothing here is on a budgeted path; §6.1 checks binary size once
  because F15 measured it, not as a recurring budget.

---

## 4. Decisions

### D1 — The library check, stated rather than asserted
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Four questions.

- **The gRPC transport: `google.golang.org/grpc` v1.83.2, adopted.** The reference implementation,
  Apache-2.0, maintained by the gRPC project, pure Go. There is no second option that is not a
  reimplementation of HTTP/2 plus the gRPC framing — which would be exactly the *"hand-rolled
  non-trivial infrastructure"* the rule forbids. Note the contrast with `internal/httpclient`,
  which deliberately took **no** client dependency (`docs/ARCHITECTURE.md`'s stack table): there,
  `net/http` was already the whole protocol; here, the stdlib provides none of it.
- **Dynamic messages and JSON: `google.golang.org/protobuf` v1.36.12, adopted.** `dynamicpb`,
  `protojson`, `protodesc` and `protoreflect` are what make a schema-driven client possible without
  code generation (F4). It is already a transitive requirement of `grpc` itself.
- **`.proto` compilation: `github.com/bufbuild/protocompile` v0.14.1, adopted.** A pure-Go protobuf
  compiler, Apache-2.0, maintained by Buf, and the library `protoc` alternatives in Go are built on
  (it is the successor to `jhump/protoparse`, by the same author). The alternative is *shelling out
  to `protoc`*, which fails immediately on the requirement: this app ships as a signed, sandboxed
  `.app` and cannot assume a toolchain on the user's machine, let alone execute one. F1 verifies it
  resolves well-known imports from its own embedded copies, which is the other half of that
  requirement.
- **Reflection: `grpc-go`'s own generated client, and `github.com/jhump/protoreflect` declined.**
  This is the one genuine trade-off, and it is declined on a stated requirement rather than on line
  count. `grpcreflect` is smaller at the call site (F2 route A, ~6 lines against ~110), is
  well-maintained, and handles the v1/v1alpha negotiation. **The requirement it does not meet is
  the dependency set**: v1.18.1 pulls in `github.com/golang/protobuf` — the *deprecated* APIv1
  module — and a **beta** of its own v2 (F3), and this repo has no other deprecated or pre-release
  module in it. Route B needs no module the binary would not already link, and F2 ran it end to end
  including transitive dependency resolution. `github.com/fullstorydev/grpcurl` was also considered
  and declined for a stronger version of the same reason: it is a CLI's library, it depends on
  `jhump/protoreflect`, and it would drag a formatting/invocation layer this app has its own opinion
  about.

### D2 — The kind is `'grpc-request'`, in the existing `'http'` mode, with its own view directory
`tabKindSchema` gains a ninth member; `RENDERABLE_TAB_KINDS`, `tabRecordSchema`'s union,
`TAB_KIND_MODE` (→ `'http'`) and Go's `model.RenderableTabKinds` follow (F17). The name follows
`'http-request'`'s own reasoning (P2 D2): it names a protocol **and** a surface, and a kind spelled
`'grpc'` inside a mode spelled `'http'` would be exactly as confusing as `'http'` would have been.
The view directory is `views/grpcrequest/`, no separator, matching `views/httprequest/` and
`views/keyvalue/`.

The registry entry, all eight members:

| Member | Value |
|---|---|
| `mode` | `'http'` — the same shell, the same tab strip, the same left panel |
| `title` | `grpcRequestTitle(state)` — the saved `name`, else `Service/Method`, else the target, else `'New gRPC request'` |
| `icon` | `'symbol-interface'` — distinct from `'globe'` at a glance in a strip holding both kinds |
| `railColor` | `undefined` — no connection (P1 F17) |
| `defaultState` | `defaultGrpcRequestTabState()` |
| `duplicateState` | a structural copy of the source's request, `itemId`/`name` cleared — `'http-request'`'s own deliberate break with *"same target, fresh default state"* (P2 D2), for the identical reason |
| `dropResources` | `noDrop` — runtime lives in `views/grpcrequest/state.ts`, freed by `cleanupTabRuntime`; **plus** the call must be cancelled, which D8 does through the existing `registerTabRuntimeCleanup` hook rather than through `dropResources` |
| `menuExtras` | `[]` — no project panel to reveal into |

`path` is the literal constant `'grpc-request'`, for P2 D2's reason verbatim: `model.TabRecord.Validate`
requires a non-empty path (P2 F2), a gRPC request has no target outside its own state, and identity
is the tab's `id`.

### D3 — `internal/grpcclient`: one package, dependency-free of the rest of the app
Mirrors `internal/httpclient`'s own shape and its own stated property (`client.go:1-6`:
*"self-contained and dependency-free — no adapters, adapterhost, storage or Wails import"*), so it
is drivable from a plain in-process `grpc.Server` in its own tests. Six files, listed in §0.1.

Its public surface is three functions and two types:

```go
// Schema is the projection the renderer browses — never a descriptor, never a registry.
func Describe(ctx context.Context, src Source) (Schema, error)

// Unary runs one request/response call. onEvent is nil.
func Unary(ctx context.Context, req CallRequest) (CallResult, error)

// ServerStream runs one server-streaming call, delivering each message through onEvent as it
// arrives, and returning the terminal result when the stream ends.
func ServerStream(ctx context.Context, req CallRequest, onMessage func(Message)) (CallResult, error)
```

`Source` names a descriptor source (D4); `CallRequest` carries the target, the TLS decision, the
fully-qualified method, the request JSON and the metadata (D5).

### D4 — Two descriptor sources, one abstraction, and a private registry per source
Both sources produce `protoreflect.FileDescriptor`s (F1, F2), so:

```go
type SourceMode string   // "reflection" | "proto"

type Source struct {
    Mode        SourceMode
    Target      string      // reflection only — the same target the call uses
    TLS         TLSConfig   // reflection only
    Metadata    []MetaPair  // reflection only: a reflection call may need auth too (§0.3)
    ProtoPath   string      // proto only — one file, chosen by FilesService.ChooseOpen
    ImportPaths []string    // proto only — directories; defaults to the file's own directory
}
```

**Every resolution builds its own `*protoregistry.Files`.** `protoregistry.GlobalFiles` is never
touched, anywhere in this package — F14 measured that a duplicate path there is a **panic**, and
two `.proto` files declaring the same package is an ordinary situation. §6.6 makes this a grep.

**The reflection client** (`reflect.go`) opens one `ServerReflectionInfo` bidi stream, sends
`ListServices`, then `FileContainingSymbol` per service, and links every returned
`FileDescriptorProto` with `protodesc.NewFile` into that private registry — recursing through
`FileByFilename` for any dependency the server did not volunteer (F2: `grpc-go` volunteers them,
the protocol does not require it). `grpc.reflection.v1.ServerReflection` is tried first and
`grpc.reflection.v1alpha.ServerReflection` on `codes.Unimplemented`, which is the same negotiation
`NewClientAuto` performs and is ~15 lines here.

**The `.proto` source** (`proto.go`) is `protocompile.Compiler{Resolver:
protocompile.WithStandardImports(&protocompile.SourceResolver{ImportPaths: …})}` (F1). Import paths
default to the chosen file's own directory, and the user can add more.

**`Schema` is a projection, not a descriptor tree**, because the renderer must not parse a wire
protocol (§0.3) and because a full descriptor set is megabytes:

```go
type Schema struct {
    Services []Service `json:"services"`
    // Source-level facts worth showing: which mode answered, and (reflection) what it took.
    Mode     string    `json:"mode"`
    Warnings []string  `json:"warnings"`
}
type Service struct { Name string; Methods []Method }
type Method struct {
    Name, FullName    string
    ClientStreaming   bool
    ServerStreaming   bool
    InputType         string   // fully-qualified
    OutputType        string
    // The empty-instance JSON of the input message, EmitUnpopulated + Multiline — the
    // "fill this in" template the editor seeds with (D17). Computed in Go because the renderer
    // has no descriptors.
    RequestTemplate   string
}
```

`RequestTemplate` is the single most useful thing a schema-driven client can give a person and it
costs one `protojson.MarshalOptions{EmitUnpopulated: true, Multiline: true, Indent: "  "}.Marshal`
over a fresh `dynamicpb.NewMessage(method.Input())` (F4). It is deliberately **not** recursive into
nested message fields (a self-referential message would not terminate); a nested message field
renders as `{}` and the user fills it in.

**Descriptors are cached in memory, per `Source`, for the life of the process** — a plain
`map[sourceKey]*resolved` under a mutex in `descriptors.go`, invalidated by an explicit *Reload*
action in the UI and never by a timer. They are **never persisted** (§0.2, OQ-2): they are derived,
they are large, and a cached-but-stale schema silently disagreeing with a live server is a worse
failure than one refetch. The cache key is the source's own fields — which for reflection includes
the *resolved* target and metadata; that map lives in memory only and is never logged (D10).

### D5 — The wire shapes live in Go and are mirrored, not re-validated, in TypeScript
P2 D5's rule, applied a fourth time (after P3, P8, P9/P10). `packages/shared/domain/grpc.ts`
mirrors `internal/grpcclient`'s exported structs field for field; `control.ts` `trust<T>()`s the
bound results exactly as it does for `HttpResponseWire`.

The tab state, following `httpRequestTabStateSchema`'s discipline exactly — **every field
`.default()`ed**, flat rather than nested, so a tab saved by an earlier build restores through
`TabKindDef.parseState`'s merge-only normalisation (`docs/ARCHITECTURE.md`'s restore paragraph):

```ts
const grpcRequestTabStateShape = z.object({
  target:        z.string().default(''),
  tlsMode:       z.enum(['plaintext', 'tls']).default('tls'),
  caFile:        z.string().default(''),          // a path, never bytes
  serverName:    z.string().default(''),          // TLS SNI / authority override
  descriptorMode: z.enum(['reflection', 'proto']).default('reflection'),
  protoPath:     z.string().default(''),
  importPaths:   z.array(z.string()).default([]),
  service:       z.string().default(''),          // fully-qualified
  method:        z.string().default(''),          // method name within the service
  message:       z.string().default(''),          // the request JSON the user authored
  metadata:      z.array(grpcMetadataSchema).default([]),
  itemId:        z.string().nullable().default(null),
  name:          z.string().default(''),
  requestPane:   z.enum(['message', 'metadata', 'schema']).default('message'),
  responsePane:  z.enum(['messages', 'metadata', 'history']).default('messages'),
  requestPaneHeight: z.number().int().min(0).default(0),
});
```

`grpcMetadataSchema` is `{name, value, enabled}` — deliberately the same three fields as
`httpHeaderSchema` (`domain/http.ts:183-187`) with the same `enabled`-is-builder-state-only rule
(P2 D6), because it is the same idea and a person moving between the two tabs should not have to
learn a second one. It is **not** the same type: gRPC lowercases keys (F6) and has its own
validity rule, and sharing the Zod object across two protocols to save four lines is the coupling
P12 would then have to unpick.

### D6 — The target is normalised before it is dialled, and TLS is an explicit toggle with no verification opt-out
**Normalisation** (`target.go`), from F12's measured cases:

1. Trim. Empty → `E_BAD_REQUEST` *"a target is required"* (never `grpc-go`'s own
   *"delegating_resolver: invalid target address"*).
2. A leading `http://`, `https://`, `grpc://` or `grpcs://` is **stripped, and sets the TLS toggle**
   (`http`/`grpc` → plaintext, `https`/`grpcs` → TLS) unless the user has already set it
   explicitly — the friendly half of P2 D4's scheme handling, adapted to a protocol where a scheme
   is not part of the address. The UI reflects the change rather than doing it invisibly (D17).
3. A `dns:`, `unix:`, `unix-abstract:` or `passthrough:` prefix is a **real gRPC resolver scheme**
   (F12: both tested ones dial correctly) and passes through untouched.
4. Anything with a path, query or fragment is refused with a message naming the offending part —
   F12 measured that `host:port/some/path` otherwise fails as *"lookup tcp/1/some/path: unknown
   port"*, which names nothing the user typed.
5. A bare host with no port gets `:443` under TLS and is **refused** under plaintext with *"a
   plaintext target needs an explicit port"* — there is no conventional default, and guessing is
   worse than asking.

**TLS**: `credentials.NewTLS(&tls.Config{RootCAs: …, ServerName: …})` when the toggle is on,
`insecure.NewCredentials()` when off. **`InsecureSkipVerify` is not offered** (§0.2): P2 D4 states
*"TLS verification is always on … with no per-request opt-out"*, and this phase does not open the
first hole in that. The two real cases are covered instead — **plaintext** for local development
(what `grpcurl -plaintext` is for, and F10 measured that the failure without it is the opaque
*"error reading server preface: EOF"*), and an **optional CA-certificate file** (a path, read by Go,
appended to a fresh `x509.CertPool`) for an internal CA or a self-signed server. `serverName`
overrides SNI/authority for the case where the certificate does not match the dialled host.
OQ-4 records the argument for a gated "trust this certificate" affordance.

### D7 — A unary call is one bound call, one op, on the existing scheduler
`bridge/grpc.go`'s `Call` is `bridge/http.go`'s `Send` with a different payload, deliberately down
to the ordering:

```go
spec := adapterhost.OpSpec{ConnectionID: nil, Kind: "grpc", OpID: args.OpID, TabID: &tabID}
_, value, err := s.Deps.Router.Host().RunOp(ctx, spec, func(runCtx context.Context, op *adapters.OpCtx) (any, error) {
    op.SetCommand(args.Service + "/" + args.Method + " → " + args.Target)   // UNRESOLVED (§0.3)
    resolver, err := s.Deps.HttpVars.NewResolver(args.CollectionID, args.EnvironmentID)  // D9
    …
    result, callErr := grpcclient.Unary(runCtx, resolved)
    …
})
```

P2 F10 already proved `RunOp` tolerates `ConnectionID: nil` end to end and P2 D3's argument for
joining the existing op log rather than inventing one applies unchanged — `ViewChrome`'s
`RunState` ring, the Operations panel and the **Stop button** are all fed by `opsState`, which is
fed only by `control.onOpUpdate`. The op kind `'grpc'` joins `opKinds`/`opKindSchema` (F17); a
non-`OK` gRPC status is **not** a Go error for op-log purposes for the same reason a 404 is not
(`bridge/http.go:55-58`: *"the op is the exchange"*) — `PermissionDenied` from a server the user is
testing is the answer, not a failure.

`grpcclient.Unary` builds one `*grpc.ClientConn` per call and closes it (F16: `NewClient` is lazy,
so this costs microseconds plus the connection the call needs anyway; OQ-8 records pooling).

### D8 — A server-streaming call holds one op open and pushes coalesced batches on one new channel
The one genuinely new mechanism in the phase, so the reasoning is stated in full.

**The op stays open for the life of the stream.** P2 F12 established that a long-held bound call
cannot block the control plane (the data plane already holds a poll open for 20 s over the same
transport), and it buys three things for free: the ring and elapsed figure in `ViewChrome`, an
Operations-panel row for the whole call, and — decisively — **the Stop button**, because
`OpsService.Cancel` → `Host.CancelOp` cancels the derived context and F8 measured that this ends a
gRPC stream cleanly at `codes.Canceled` with everything already received still received.

**Messages reach the renderer through `appcore.Emitter`, not the bound call's return value**, on
one new channel `kira:grpc:call` (`ChannelGrpcCall`), delivered with **`EmitTo(windowKey, …)`** —
the args carry `windowKey`, exactly as `TabsService.List`/`Save` and `WindowsService.Ensure`
already do (`control.ts:334-340`), so a stream in one window never wakes another. The bound call
still returns the terminal `CallResult` (status, trailers, counts, elapsed), so a caller that
misses every event still ends in a correct final state.

**Batches are coalesced in Go.** A server can emit thousands of messages per second, and one Wails
event per message would be a flood the renderer cannot render anyway. `call.go` accumulates into a
bounded buffer and flushes on whichever comes first: **60 ms elapsed**, **64 messages**, or a
terminal event (end, error, cancel), which is flushed immediately. Each event carries
`{callId, seq, messages: [...], done, status?}` where `seq` is the index of the first message in
the batch, so the renderer appends by index and a future reviewer can detect a gap.

**Why not polling**, which was the obvious alternative and needs no new channel: a poll's latency
floor is its interval, and the whole point of a streaming view is watching messages arrive (F5
measured 20 ms spacing on a deliberately slow server); a poll also has to guess an interval that is
wrong for both a 1-message-per-minute feed and a 1000-per-second one, where the coalescing window
above is correct for both. **Why not the data plane** (`packages/shared/protocol/wire.fbs`): that
is the adapters' bulk-page transport, built around FlatBuffers-encoded result pages and
`connectionId`-keyed sessions; a gRPC message is a short JSON string on the control plane, and
putting it there would couple the Api module to Studio's data plane at precisely the seam P12
exists to separate.

**Client-streaming and bidi are out of scope** (§0.2) — not because they are hard (F5: identical
primitives) but because each needs a UI this row does not ask for: a half-closed state, a
send-another-message affordance and an interleaved request/response log. OQ-1.

### D9 — `{{name}}` substitution is reused exactly, through one behaviour-preserving extraction
Three fields are substituted: the **target**, every enabled metadata **name and value**, and the
**request message JSON**. Deliberately *not* substituted: `protoPath`, `importPaths` and `caFile` —
they are picker-supplied local paths, which is P5 D7's own rule for a form-data file row's path
(`httpvars/resolve.go:142`) and P5 OQ-7's own open question, re-handed rather than reopened.

Stage 1 stays in the renderer: `views/grpcrequest/state.ts`'s `call()` runs `resolveTabState`'s
gRPC twin over the same `http/substitute.ts` `resolve()` and the same
`mergedValuesAndSecrets`/`loadDynamicGenerator` short-circuit `views/httprequest/state.ts:161-229`
uses — so `{{$dynamic}}` values work in a gRPC request with no second generator, and the same
"unresolved references" chip logic applies.

Stage 2 stays in Go. `httpvars` gains a `Resolver` (F21):

```go
// NewResolver fetches every secret reachable from the scope once and returns a resolver that
// substitutes text and accumulates what it actually used. ResolveRequest is reimplemented on it,
// behaviour-identical (its own tests pass unedited).
func (s *Service) NewResolver(collectionID, environmentID string) (*Resolver, error)
func (r *Resolver) Text(text string) string
func (r *Resolver) Any() bool                    // false ⇒ nothing to resolve, skip the walk
func (r *Resolver) Used() map[string]string      // name → value, for the masking replacer
```

`bridge/grpc.go` walks its own three fields with it. **`httpvars` gains no gRPC import**, which is
what keeps it protocol-neutral rather than becoming a two-protocol module.

### D10 — Secrets: the checklist, field by field
Every place a resolved secret could reach persistence, a copyable surface, or a log — with what
this phase does about each. `AGENTS.md` and §0.3 make this a hard requirement, not a review item.

| Carrier | Risk | What happens |
|---|---|---|
| `op_log.command` | persisted SQLite column, rendered in the Operations panel | `op.SetCommand` receives the **unresolved** target and method, both before and after the call (P5 D6/F3's exact ordering, `bridge/http.go:72-77`) |
| `grpc_call_history.target` / `.method` / `snapshot_json.request` | persisted | recorded from `args`, **never** from the resolver's output — P8 D2's rule verbatim; a secret stays spelled `{{name}}` |
| request **metadata** | the single likeliest carrier (`authorization: Bearer {{token}}`) | resolved only inside the `RunOp` closure, handed straight to `metadata.AppendToOutgoingContext`, never fed back into anything logged or stored; the stage-1 form is what history records |
| the request **message JSON** | can contain a secret in a field | same — resolved at point of use, stage-1 form persisted |
| the **reflection** call's own metadata | a reflection fetch may need the same auth, and it is a *separate* call from the invoke | resolved through the same `Resolver` in the same bridge method, never persisted at all (a `Describe` result records no history row) |
| the descriptor **cache key** (D4) | contains the resolved target and metadata | in-memory only, never serialised, never logged; the cache map is unexported and has no accessor that returns a key |
| `slog` | | names only, at `Debug`, reusing `httpvars`' existing line (`resolve.go:229-235`) — the *"the subject, not the secret"* precedent. `grpcclient` logs a target only in its **unresolved-agnostic** form: it never logs metadata values at any level |
| the **response** message / trailer text | a server can echo a token back | **accepted, and unchanged** — P8 OQ-6 already records exactly this for an HTTP response body, and P10 OQ-5 extended it to per-hop headers; a gRPC response message and trailer join that same open question rather than opening a new one (OQ-9) |
| an **error message** returned to the renderer | `mapGrpcError`'s `Details` (P10 D15's channel) | anything derived from the resolved request is masked with the **same** `strings.Replacer` shape `bridge/http.go:145-160`'s `secretReplacer` builds — factored into one unexported helper the two files share, since a second consumer now exists |

The property P9 D6 stated holds unchanged and is why the replacer is safe: **over-masking is
possible; under-masking is not.**

### D11 — A new `grpc_call_history` table, not a widened `http_response_history`
The brief asks this to be decided and justified. **Its own table**, on F19's four measurements:
the shared `status` column would mean an HTTP status for one protocol and a `codes.Code` for the
other with `statusClass(0) === 'err'` silently mis-colouring gRPC's `OK`; `storedSnapshot` embeds
`httpclient.Response` by value and would become a union in a `Get` that deliberately reports decode
failures rather than blanking; the byte caps have no message-count equivalent; and the renderer
halves cannot be shared anyway, because `biome.json` forbids `views/grpcrequest/**` from importing
`views/httprequest/**` (F18) — so widening the *table* would buy shared SQL and nothing else.

**What is deliberately mirrored rather than abstracted**, with the reason: the `scope_key GENERATED
ALWAYS AS (COALESCE(item_id, 'tab:' || tab_id)) VIRTUAL` column (P8 F8 verified it is indexable on
the shipped driver), the insert-then-trim per-scope cap, the window-function global byte sweep,
`Adopt` and `SweepOrphans`. This repo has now applied that pattern in `filter_history`,
`http_variable_history` and `http_response_history`; a fourth application is following a precedent,
not duplicating an abstraction that exists. OQ-6 hands the "should these four share a helper"
question to P12, which is the phase already reading every one of these files.

```sql
CREATE TABLE grpc_call_history (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES http_items(id) ON DELETE CASCADE,
  tab_id        TEXT NOT NULL,             -- deliberately NOT an FK into tabs (P8 F4)
  scope_key     TEXT GENERATED ALWAYS AS (COALESCE(item_id, 'tab:' || tab_id)) VIRTUAL,
  called_at     TEXT NOT NULL,
  target        TEXT NOT NULL,             -- STAGE 1: a secret is still spelled {{name}}
  method        TEXT NOT NULL,             -- fully-qualified: pkg.Service/Method
  streaming     TEXT NOT NULL,             -- 'unary' | 'server'
  environment   TEXT NOT NULL DEFAULT '',  -- the NAME at call time (P8's own reasoning)
  code          INTEGER NOT NULL,          -- codes.Code: 0 = OK
  code_name     TEXT NOT NULL,             -- 'OK', 'PermissionDenied', …
  status_message TEXT NOT NULL DEFAULT '',
  elapsed_ms    INTEGER NOT NULL,
  message_count INTEGER NOT NULL,          -- messages actually received
  message_bytes INTEGER NOT NULL,          -- total wire bytes received
  stored_bytes  INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL              -- last column: SQLite spills the tail to overflow pages
);
CREATE INDEX grpc_call_history_scope ON grpc_call_history(scope_key, called_at);
CREATE INDEX grpc_call_history_age   ON grpc_call_history(called_at);
CREATE INDEX grpc_call_history_tab   ON grpc_call_history(tab_id);
```

**Four caps, because a streamed call can grow in a way a response body cannot** — the first three
are P8 D6's three, the fourth is genuinely new:

| cap | value | why |
|---|---|---|
| per-message stored bytes | 64 KiB | one message, truncated with a flag; the analogue of P8's per-body cap |
| stored messages per entry | 100 | a 10,000-message stream stores its first 100 and records `messagesElided: true` with the true `message_count` — the same "truncate visibly, never silently" rule P8 D5 and P9 D4 both take |
| entries per scope | 20 | `historyPerScopeLimit`'s exact value and shape |
| bytes across the table | 32 MiB | a quarter of `http_response_history`'s 128 MiB, because a gRPC call's stored payload is capped an order of magnitude lower (100 × 64 KiB worst case ≈ 6.4 MiB per entry, against 256 KiB) and the two budgets are independent |

Only a **completed** call is recorded (any terminal status, including a non-`OK` one and a
cancellation that received messages) — an in-flight stream writes nothing, so a long-running stream
costs no incremental storage. Recording is **best-effort**, exactly as `bridge/http.go:118-130`'s
is: a failed insert logs and the call still returns.

### D12 — A gRPC request is a sibling row in `http_items`, distinguished by `protocol`, not by `kind`
```sql
ALTER TABLE http_items ADD COLUMN protocol TEXT NOT NULL DEFAULT 'http';
```

**Why a column and not a third `kind`.** `kind` is structural — `'folder'` versus a leaf — and the
tree reads it that way in both languages (`http/state/collections.ts:151`'s `hasChildren`,
`CollectionsTree.vue:60-67`'s `onOpen`, `model.IsCollectionItemKind`). Adding `'grpc'` there would
turn every `kind === 'request'` check into a two-value test and every `!== 'request'` check into a
latent bug. `protocol` adds one branch at exactly one place (open) and leaves the structural checks
alone. It also reads correctly in the schema: a folder's protocol is meaningless and its default is
harmless.

`request_json` stays the one document column, typed by `protocol`: `model.SavedRequest` for
`'http'`, `model.SavedGrpcRequest` for `'grpc'`. The denormalised pair is reused rather than
extended — `method` holds `pkg.Service/Method` and `url` holds the target — so the tree's existing
search-the-url behaviour works unchanged and `CollectionRow.vue`'s leading chip becomes the
streaming kind (`UNARY` / `STREAM`) via a `grpcMethodClass` sibling of `httpMethodClass`, living in
`packages/shared/domain/grpc.ts` for P4 D16's exact reason (`http/**` may not import `views/**`).

**Import and export.** Import never produces a gRPC row (F22 — the format cannot express one).
Export **skips** every `protocol='grpc'` item and reports the skip: `ExportReport` gains
`SkippedGrpc int`, and `ImportReportStrip.vue`'s existing surface says *"N gRPC requests were not
written — the Postman Collection v2.1 format has no representation for them."* Silently dropping
them would be the worst available behaviour, and P4 D12's own rule says so.

**Creating one**: the collection tree's row and background menus gain *New gRPC request*
(`menus.ts`'s injected-action shape, one more member on `CollectionMenuActions`), and `HttpStart.vue`
gains a fourth front-door button. `openGrpcRequestTab` mirrors `openCollectionRequestTab`'s reuse
lookup (`state/tabs.ts`).

### D13 — A new view, not an extended `HttpRequestView`
The brief asks this to be decided and justified. **A new view**, `views/grpcrequest/GrpcRequestView.vue`,
on four grounds — the first three are about the code, the fourth is about the chapter.

1. **Almost nothing overlaps.** `HttpRequestView.vue` (`:232-346`) is a method `<select>`, a URL
   field, a Params/Headers/Body segmented control, and a response pane with five segments (Body,
   Headers, History, Raw, Timeline). A gRPC request has no method enum, no URL, no query params, no
   body-mode vocabulary, no status code, no redirects, no raw exchange (D14) and no timeline (D14).
   The genuine overlap is a target-ish text field, a name/value table, a splitter and a Send button
   — all of which are *primitives*, already shared, and already reachable from both (F23).
2. **Extending would mean a discriminator inside `httpRequestTabStateSchema`**, and every consumer
   of it — `saved.ts`'s dirty comparison, `body.ts`, `url.ts`, `curl/generate.ts`, `raw/generate.ts`,
   `history.ts`, `TimelinePane.vue`, `RawExchangePane.vue`, `model.SavedRequest.Validate` — would
   grow a *"unless it's gRPC"* branch. That is nine files made conditional to avoid creating two.
3. **`biome.json` already forbids the sharing that would tempt** (F18): `views/grpcrequest/**` may
   not import `views/httprequest/**`. So even the "reuse just the response pane" middle ground is
   not available, and pretending otherwise would mean moving HTTP panes into `views/shared/` — a
   refactor of P2–P10's output in service of a phase that does not need it.
4. **P12's separability audit gets easier, not harder.** `docs/v1.2/SPEC.md`'s module-boundary
   section wants the Api module extractable as a mechanical move; two sibling protocol directories
   under one mode move as cleanly as one, whereas a single polymorphic view with a protocol
   discriminator is precisely the *"merge Http and Studio code into one shared file where a
   per-module file would do"* shape that section forbids — applied one level down, between the two
   protocols the renamed **Api** module hosts.

**The layout**, deliberately isomorphic to the HTTP tab so the mode reads as one product:

- `ViewChrome` header — the title, a streaming-kind chip, the dirty mark, the unresolved-references
  chip (all four already exist for HTTP, three of them as shared code).
- **Toolbar row 1**: the target `TextField`, a TLS/plaintext toggle, the **method picker** (an
  `AutocompleteField` over the resolved schema, showing `Service/Method` with a streaming badge —
  F23: no new primitive), Save, and **Call** (primary; `view.run` registers to it, P2 F15).
- **Toolbar row 2**: the request-pane `SegmentedControl` (**Message · Metadata · Schema**) and the
  existing `EnvironmentSelect`.
- **Request pane**: *Message* is a `CodeMirrorHost` JSON editor seeded with the method's
  `RequestTemplate` (D4) and beautifiable through the existing `beautify.ts`; *Metadata* is a
  name/value/enabled table (`FieldRowsTable`'s shape, reimplemented in this directory per F18, not
  imported); *Schema* is the browser — the source selector (Reflection / `.proto` file + import
  paths + a *Reload* button) above a service→method list.
- `PanelSplitter`, then the **response pane** (D14).

The service/method browser lives **inside the tab**, not in the left panel: the left panel is the
collections tree and is shared with the HTTP tab, a schema is a property of one request's target
rather than of the workspace, and putting it there would finally force P5 OQ-8's per-mode panel
width for a surface that does not need to be that wide. §1.6.

### D14 — The response pane: messages, metadata, history — and no Raw, no Timeline
Three segments: **Messages · Metadata · History**.

- **Messages** is the pane. A status line (`OK` / `PermissionDenied` chip via `grpcCodeClass`, the
  code number, the status message, elapsed, *"N messages · 4.2 KB"*), then the message list: one
  collapsible entry per message with its **arrival offset** (`+0 ms`, `+20 ms` — F5 measured these
  are real and they are the single most informative thing about a stream), its wire size, and its
  JSON body rendered through `CodeMirrorHost` read-only. A unary call is the same pane with exactly
  one entry, expanded — one component, not two. `VirtualList` backs the list, since a stream can
  legitimately deliver thousands (F23).
- **Metadata** shows response **headers** and **trailers** as two labelled groups (F6: they are
  distinct, and a gRPC server commonly puts its real error detail in a trailer, which is exactly
  the thing a person is looking for when a call fails).
- **History** is `grpc_call_history` for this scope, in `ResponseHistoryList.vue`'s shape,
  reimplemented in this directory (F18). Selecting an entry swaps the pane's source, which is
  P8 D10's own "swapped source, no second viewer" technique.

**No Raw pane — this answers P9 OQ-9, and the answer is *absent*.** A gRPC exchange on the wire is
HPACK-encoded HTTP/2 frames carrying length-prefixed, optionally compressed protobuf. There is no
text rendering of it that is not a fabrication, `grpc-go` exposes no hook that yields the bytes
short of forking `internal/transport`, and the two things a person actually wants from a raw view
— *what did I send* and *what came back* — are the message editor and the message list, exactly.
The one genuinely wire-level fact worth having, each message's compressed wire length, is shown
per message from `stats.Handler`'s own `WireLength` (F7) rather than through a pane. `RawExchangePane.vue`
is **not** inherited, exactly as P9 OQ-9 instructed.

**No Timeline pane — this answers and corrects P10 OQ-8.** F7 measured that `httptrace` fires
nothing for a gRPC call, so the mechanism P10 handed forward does not exist here; and
`stats.Handler`, which does, reports no DNS/connect/TLS split at all, so the five-phase waterfall
`TimelinePane.vue` draws has no counterpart. The per-message offsets in the Messages pane are the
honest timing surface for this protocol. OQ-3 records what a real gRPC timeline would be built from
if a later phase wants one.

### D15 — Caps: what is bounded, and what each bound reports
Every one is *report, never hide* — the rule P2 D4, P8 D5 and P9 D4 all take.

| bound | value | on exceeding |
|---|---|---|
| receive message size | **16 MiB** via `grpc.MaxCallRecvMsgSize` | `codes.ResourceExhausted` with `grpc-go`'s own text (F9), surfaced with D17's sentence naming the limit and that it is this app's, not the server's |
| send message size | `grpc-go`'s default (`MaxInt32`) | unchanged — the request is text the user typed |
| messages held in the live view | **10,000**, oldest dropped | the pane says *"showing the most recent 10,000 of N messages"*; an infinite stream must not grow the renderer without bound |
| call duration | **none by default** | a stream is legitimately open-ended, unlike `httpclient`'s 30 s (`client.go:30`). An explicit, optional per-request deadline field is **not** in this phase (OQ-10); the Stop button is the bound, and F8 verified it works mid-stream |
| stored per entry | D11's four caps | flags on the stored snapshot |

The absent default deadline is the one place this phase deliberately diverges from the HTTP
sibling, and it diverges because the protocols differ: a 30 s cap on a subscription stream would be
a bug, not a safeguard.

### D16 — `grpcclient` owns its own error vocabulary, in the `ipcerr` family
P2 D8's rule, applied again: `httpclient` defined `CodeBadRequest`/`CodeTimeout`/`CodeCancelled`/
`CodeHTTPTransport` rather than reusing `adapters.ErrorCode`, because `views/shared/viewOp.ts`'s
`DISCONNECTED_CODES` would misread an adapter connect code as *"the database connection is gone"*
and pop a Reconnect gate over a tab with no connection.

`grpcclient` defines four of its own — `E_GRPC_BAD_REQUEST` (a malformed target, an unknown method,
a request JSON that fails `protojson`, an illegal metadata key), `E_GRPC_SCHEMA` (reflection
unavailable, a `.proto` that will not compile, a method not present in the resolved schema),
`E_GRPC_TRANSPORT` (dial, TLS, `Unavailable`) and `E_GRPC_CANCELLED` — plus the crucial distinction
that **a non-`OK` gRPC status is not one of them**. A `PermissionDenied` from the server is a
*result*: it comes back as a normal `CallResult` with `code: 7`, is rendered in the status chip, is
recorded in history, and logs the op as `ok`. Only a failure to *make the call at all* is an error.
The one case that needs care is `codes.Unavailable`, which F10 showed covers a refused connection,
a TLS verification failure and a plaintext/TLS mismatch alike — D17 gives it three sentences keyed
on the error text rather than one.

`mapGrpcError` mirrors `mapHttpError` (`bridge/http.go:218-232`) including P10 D15's `Details`
channel, so a failure can carry the partial message list it got as far as.

### D17 — What each sentence says
Written once here so the implementation writes them once and review can check them against the
measurements they come from.

| condition | text | source |
|---|---|---|
| reflection returns `Unimplemented` | This server does not expose gRPC reflection. Supply a `.proto` file instead. | F11 |
| plaintext client, TLS server | The server closed the connection without responding. It is probably expecting TLS — try switching this request to TLS. | F10 |
| TLS handshake fails verification | The server's certificate was not trusted. If it uses an internal or self-signed CA, point this request at that CA's certificate file. | F10, D6 |
| the target had a scheme stripped | `https://` is not part of a gRPC target — using `api.example.com:443` over TLS. | F12, D6 |
| the target has a path | A gRPC target is a host and port, not a URL — remove `/{path}`. | F12 |
| plaintext target with no port | A plaintext target needs an explicit port. | D6 |
| `protocompile` fails | *(verbatim, it is already `file:line:col`)* | F1 |
| request JSON fails `protojson` | *(verbatim — it is already `(line L:C): unknown field "x"`)* | F4 |
| an illegal metadata key | `{key}` is not a valid metadata key — gRPC allows lowercase letters, digits, `-`, `_` and `.`. | F6 |
| metadata keys were lowercased | Metadata keys are sent lowercase. | F6 |
| a message exceeded 16 MiB | A message was larger than the 16 MB this app will receive. This is Kira's limit, not the server's. | F9, D15 |
| the live list hit its ceiling | Showing the most recent 10,000 of {n} messages. | D15 |
| stored messages elided | This entry stored the first 100 of {n} messages. | D11 |
| the call was stopped | Stopped after {n} messages. | F8 |
| the stream ended non-`OK` | The stream ended with {code}: {message}. {n} messages were received before it did. | F8 |
| a method's input is `google.protobuf.Empty` | This method takes no request fields. | D4 |
| no schema resolved yet | *(empty state)* Choose a source above to browse this server's services. | D4 |

### D18 — Nothing about the HTTP path changes
Stated as an invariant with a check behind it, the way P10 D16 stated its own.

- **Unchanged**: `internal/httpclient` (every file), `httpRequestTabStateSchema`,
  `model.SavedRequest`, `http_response_history` and its three caps, `ResponsePane.vue`'s five
  segments, `postman/parse.go`, and every `tests/ui/http-*.spec.ts`.
- **Changed, and behaviour-preserving**: `httpvars.ResolveRequest`'s body is reimplemented on D9's
  `Resolver` with its signature and semantics identical; `bridge/http.go`'s `secretReplacer` moves
  to a shared unexported helper in the same package. `internal/httpvars/resolve_test.go` and
  `bridge/http_test.go` passing **unedited** is the check that both were behaviour-preserving.
- **Changed, additively**: `http_items` gains a defaulted column; `postman/write.go` gains a skip
  branch reachable only for a row this phase can create.

---

## 5. Implementation order

Eleven commits — the largest phase in this chapter, and the sequence is chosen so the first five
add capability with nothing mounted, C6–C9 make it visible one surface at a time, and C10–C11 are
tests and docs. Per `AGENTS.md`, run the fast checks (`lint`, `typecheck`, `build`, `go build`,
`go vet`) per commit and the expensive suites once at the end.

### C1 — `chore(deps): grpc-go, protobuf-go and protocompile`
`go.mod`/`go.sum` only, plus one throwaway compile-check file deleted in the same commit. Separate
and first because it is the phase's one dependency decision (D1, F3, F15) and reverting it reverts
the phase.

### C2 — `feat(shared): the gRPC request/response domain`
`packages/shared/domain/grpc.ts`: the wire mirrors, `grpcRequestTabStateSchema`,
`defaultGrpcRequestTabState`, `grpcMethodClass`, `grpcCodeClass`, `GRPC_CODE_NAMES`, the
`grpcRequestTitle` helper. `packages/shared/domain/tabs.ts` and `domain/ops.ts` gain their members;
`domain/collections.ts` gains `protocol` and `httpSavedGrpcRequestSchema`;
`packages/shared/protocol/events.ts` gains the channel name. Pure addition — nothing produces or
consumes any of it yet. The Go-side halves of the two vocabularies (`model/tabs.go`, `model/ops.go`)
land here too, so the parity spec is never red between commits.

### C3 — `feat(grpc): resolve a target's services and methods from reflection or a .proto`
`internal/grpcclient/{target.go,descriptors.go,reflect.go,proto.go,errors.go}` and their tests
(§6.2). No caller anywhere — `go test ./apps/kira-studio/internal/grpcclient/...` against an
in-process `grpc.Server` is the whole proof, and F14's private-registry rule is asserted here.

### C4 — `feat(grpc): issue unary and server-streaming calls over dynamic messages`
`internal/grpcclient/call.go`: the message codec (`dynamicpb` + `protojson`, F4's two strictness
settings), `Unary`, `ServerStream` with D8's coalescing buffer, D15's caps, and cancellation. Still
no caller. The concurrency-shaped tests (§6.2) run under `-race`.

### C5 — `refactor(httpvars): extract the resolver the two protocols share`
D9/F21, on its own so it is reviewable as the behaviour-preserving refactor it is:
`internal/httpvars/resolve.go`'s `Resolver`, `ResolveRequest` reimplemented on it,
`bridge/http.go`'s `secretReplacer` factored out. **`httpvars/resolve_test.go` and
`bridge/http_test.go` pass unedited** — that is the commit's own check.

### C6 — `feat(bridge): GrpcService, on the same op scheduler the adapters use`
`internal/bridge/grpc.go` (`Describe`, `Call`), the `ChannelGrpcCall` constant, `main.go`'s service
registration, `control.ts`'s three wrappers, and the masking checklist (D10) with its shared
replacer. Regenerate bindings (§6.1's two checks).

### C7 — `feat(storage): a gRPC request is a collection row, and a call is history`
`migrations/0009_p11_grpc.sql`, `model/grpc.go`, `model/collections.go`'s `Protocol`,
`repos/collections.go`'s projection and the two new document accessors, `repos/grpc_history.go`
with D11's four caps, `postman/write.go`'s skip plus `ExportReport.SkippedGrpc`, `main.go`'s second
`SweepOrphans`, and the four history wrappers in `control.ts`. Go-side tests here (§6.2).

### C8 — `feat(api): a gRPC request tab — browse a schema, author a message, call`
The tab-kind registry entries, `views/grpcrequest/` (the view, the schema browser, the message and
metadata panes, `state.ts`'s stage-1 substitution and `call()`), and the response pane's Messages
and Metadata segments for a **unary** call. **The first commit anything is visible in**, and it is
complete on its own terms for a unary call.

### C9 — `feat(api): watch a server-streaming call's messages arrive`
The push subscription in `views/grpcrequest/state.ts`, the message list's arrival offsets, the
running/stopped states, and the Stop path. Separate from C8 because it is the one commit that
exercises the new channel end to end, and because C8 stands as a complete unary client without it.

### C10 — `feat(api): a gRPC request lives in a collection, with its own call history`
The collections tree's `protocol`-aware row and chip, *New gRPC request* in both menus and on
`HttpStart.vue`, `openGrpcRequestTab`'s reuse lookup, Save/Save as… with `Adopt`, the export
warning strip, and the response pane's History segment.

### C11 — `test: the gRPC request tab, and the widened vocabularies` / `docs(architecture): gRPC, its two schema sources, and what it cannot show`
Two commits in practice, kept adjacent: `tests/ui/grpc-request.spec.ts` (§6.4), `mockRuntime.ts`'s
`emitWailsEvent` helper and FQN entries, the parity spec's two widened lists; then
`docs/ARCHITECTURE.md` — a stack-table row for the three dependencies with F15's size measurement, a
storage paragraph for the new table and the `protocol` column with D11's justification for not
sharing one, the "no raw view, no timeline, and why" paragraph, and **explicit corrections of P9
OQ-9 and P10 OQ-8** so the wrong claim does not outlive this phase.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test -race ./apps/kira-studio/internal/...`.
`bun run setup` first in a fresh container.

**`-race` is not optional.** D8's coalescing buffer is written by the goroutine reading the stream
and read by the flush timer; `grpc-go` invokes nothing of ours concurrently, but the timer is ours.

Two bindings checks, both from `AGENTS.md`'s warnings and both learned from P9/P10's own notes
(`apps/kira-studio/frontend/bindings/**` is git-ignored, so inspect the regenerated output directly):

1. Confirm the regenerated `grpcservice.ts` calls `$Call.ByName("…bridge.GrpcService.Call", …)` and
   **not** `$Call.ByID(<n>, …)` — a `-names`-less regeneration breaks every `tests/ui` spec at the
   first bound call of boot, and nothing about the failure points at bindings.
2. Confirm no existing bound method's signature moved, and that `CollectionItem` gained exactly one
   new `protocol` field.

Also confirm `bun run build` reports the **same four** lazy chunks `docs/ARCHITECTURE.md:28`
records and no fifth — this phase adds no `await import()`.

**One size check, once**, because F15 measured that this is the app's largest single dependency
addition: record the packaged `.app` size before and after and put the delta in the commit message
for C1. It is not a budget and it is not repeated; it is the number `AGENTS.md` requires be named
rather than discovered.

### 6.2 The Go tests
Driven against a real in-process `grpc.Server` registered from a `protocompile`-compiled descriptor
with no generated code — the technique the probes proved (F1, F5). This earns dedicated tests under
`AGENTS.md`'s *"a parser/splitter with several interacting rules"* and *"concurrency (ordering,
backpressure, cancellation, races)"* clauses; everything that would merely restate a short function
body is listed at the end as deliberately untested.

**`internal/grpcclient/target_test.go`** — one table test over F12's nine measured strings plus the
no-port and CA-file cases. *The highest-value test in the phase relative to its size*: every case is
a real failure mode a user will hit, and the current-behaviour column is measured rather than
assumed.

**`internal/grpcclient/descriptors_test.go`**
1. A `.proto` with a well-known import compiles and projects the right method set, streaming flags
   included (F1).
2. Reflection against a real server projects the **same** `Schema` the `.proto` source does for the
   same file — the check that D4's one-abstraction claim holds.
3. A server without reflection yields `E_GRPC_SCHEMA` carrying F11's `Unimplemented` cause.
4. A dependency the server does not volunteer is fetched by the recursive fallback (F2) — driven by
   a stub reflection server that answers `FileContainingSymbol` with the leaf file only.
5. **Two sources whose files declare the same package both resolve, and neither panics** (F14) —
   the regression test for the crash that `GlobalFiles` would otherwise cause.

**`internal/grpcclient/call_test.go`**
1. Unary: request JSON in, response JSON out, header and trailer metadata both captured (F5, F6).
2. A non-`OK` status is a **result**, not an error: `code`, `codeName` and `statusMessage` populated
   and `err == nil` (D16). *The single most important behavioural assertion in the package.*
3. Server-streaming: N messages arrive in order with monotonically non-decreasing arrival offsets,
   and the terminal result's count matches.
4. Cancellation mid-stream: the messages already delivered are kept and the result is
   `E_GRPC_CANCELLED` with the true partial count (F8).
5. `protojson` rejects an unknown request field with its `line:col` message; `DiscardUnknown` on the
   response accepts a field the local schema lacks (F4).
6. A message over the 16 MiB cap yields `ResourceExhausted` and D17's sentence (F9, D15).
7. Coalescing: a server emitting 500 messages as fast as it can produces batches, every message
   exactly once, `seq` contiguous — run under `-race`.

**`internal/storage/repos/grpc_history_test.go`** — the four caps, each asserted on the boundary:
per-message truncation flag, the 100-message elision with a true `message_count`, the per-scope trim
at 20, and a cross-scope byte sweep (with the budget shrunk by the same test-only setter
`response_history_internal_test.go` already establishes). Plus `Adopt` moving a scratch tab's rows
and `SweepOrphans` deleting only rows whose tab is gone.

**`internal/postman/write_test.go`** — one case: a tree containing a gRPC item exports valid v2.1
JSON containing only the HTTP items, and reports the skip (F22, D12).

**Explicitly not tested**: that `grpc-go` dials, that `protojson` round-trips a scalar, that a
defaulted SQL column defaults, that the `Schema` struct marshals. Each restates a short function
body or a library's own contract — `AGENTS.md`'s *"everything else gets nothing"*.

### 6.3 No new unit spec
Nothing this phase adds to the renderer is logic with interacting rules: stage-1 substitution is
the *existing* `substitute.ts` called over three fields, and `tests/unit/http-substitution.spec.ts`
already pins it. The one candidate — target normalisation — lives in **Go** (D6), because the
normalised target is what actually gets dialled and a second renderer-side copy would be a second
thing to keep in step. The renderer displays what Go returned.

### 6.4 The UI spec — `tests/ui/grpc-request.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked. Seven tests:

1. **Open a gRPC tab and browse a schema.** Seed a `grpcDescribe` snapshot with two services;
   assert the tab opens with the right icon and title, the Schema pane lists both services and
   their methods, and each method shows its streaming badge.
2. **Choose a method and get a template.** Selecting a method seeds the Message editor with the
   method's `requestTemplate` and switches the request pane to Message.
3. **A unary call renders its status, message and metadata.** Seed a `grpcCall` result; assert the
   status chip, the single expanded message, and both metadata groups (headers *and* trailers,
   F6).
4. **A non-`OK` status is a result, not an error.** Seed `code: 7`; assert the `PermissionDenied`
   chip renders in the response pane and **no** `MessageStrip` error appears. *This is D16's
   central claim, asserted directly.*
5. **A server-streaming call appends messages as they arrive.** Drive F20's new `emitWailsEvent`
   helper with two batches on `kira:grpc:call`, then a terminal event; assert the list grows
   between them, that arrival offsets render, and that the running state clears on the terminal
   event.
6. **Stop.** With a stream running, click Stop; assert the existing `opsCancel` snapshot is
   consumed and D17's *"Stopped after N messages"* renders with the messages kept.
7. **A gRPC request in a collection.** *New gRPC request* from the tree's context menu, Save as…,
   and assert the row renders with its streaming chip and that double-clicking it opens a
   `grpc-request` tab and not an `http-request` one.

### 6.5 What only a real Mac and a real network can settle
None of these runs in this sandbox (no display, a proxied network, no macOS backend) — recorded as
unrunnable, with what was measured or reasoned instead, in the shape P9 §6.5 and P10 §6.5 took.

1. **A real gRPC server on the public internet.** *Not run* — every probe used an in-process server
   on loopback. Everything measured (F1–F14) is protocol-level and does not depend on the network,
   but a real TLS endpoint with a real certificate chain is the natural smoke test, and it is the
   only way to see whether D17's TLS sentences read correctly against a real failure.
2. **A corporate MITM proxy.** *Partially reasoned*: F13 measured that `grpc-go` honours
   `HTTPS_PROXY` in this sandbox exactly as `httpclient` does. A TLS-inspecting proxy would make
   the handshake terminate at the proxy's certificate, which D6's CA-file field can accommodate and
   the UI cannot distinguish — worth one look before P13 styles the note.
3. **A large real `.proto` tree with many import paths.** *Not run* — F1 compiled one file with one
   well-known import. `protocompile` is the same compiler `buf` uses, so a real tree is expected to
   work; the untested part is whether the import-paths UI is usable for one, which is a P13
   question as much as a P11 one.
4. **A genuinely high-rate stream.** *Partially run*: §6.2's coalescing test drives 500 messages
   from an in-process server, which is a lower bound on rate by construction. The 60 ms/64-message
   window is a judgement (D8) that a real firehose should confirm, and D15's 10,000-message live
   ceiling with it.
5. **A real secret in real metadata, end to end.** *Not run* — no macOS Keychain here
   (`KIRA_INSECURE_SECRETS=1`, `AGENTS.md`). D10's masking is a pure function over the resolver's
   `Used()` map and is unit-testable; the persisted-form claim is verified by reading what `Record`
   is handed, exactly as P8 F3 and P10 F16 were.
6. **The packaged `.app` size delta** (§6.1). *Not run* — no macOS packaging here. F15's
   `linux/amd64` numbers are the estimate; the real number belongs in C1's commit message.

### 6.6 What must not regress
- **`internal/httpclient` is byte-identical.** `git diff --stat apps/kira-studio/internal/httpclient/`
  must be empty (D18).
- **`internal/httpvars/resolve_test.go` and `internal/bridge/http_test.go` pass unedited** — the
  check that C5's extraction was behaviour-preserving. An edit needed there is a signal it was not.
- **`grep -rn "protoregistry.GlobalFiles" apps/kira-studio/internal/` returns nothing** (F14).
- **Every `tests/ui/http-*.spec.ts` and `collections.spec.ts` passes unedited.** `protocol` defaults
  to `'http'`, so every seeded collection fixture stays valid with no edit.
- **`tests/ui/mode-switch.spec.ts` passes unedited** — a second kind in the same mode must not
  change how modes are switched or how the active tab per mode is tracked.
- **A tab saved before this phase restores unchanged**, both kinds. `TAB_KIND_MODE` gains an entry
  and no existing one moves.
- **`op_log` behaviour for HTTP is byte-identical**; the only new rows are `kind = 'grpc'`.
- **`kira.sqlite` gains exactly one column and one table**, and `http_response_history`'s three caps
  are unchanged.
- **Studio renders identically.** Nothing here touches `project/**`, `views/grid/**`,
  `views/console/**`, an adapter, or the data plane. **`bun run test:ipc:fe` passes unedited** — no
  data-plane frame, adapter or fixture change.
- **No file under `http/**` imports `views/**`; no file under `views/grpcrequest/**` imports
  `views/httprequest/**`.** `bun run lint` is the check (F18).
- **`docs/PERF.md`, `NOTICES.md`, `theme/primitives.css` and `theme/tokens.css` are unchanged**
  (§3, F23).

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — the three dependencies added and pinned; the packaged size delta recorded in the commit
      message; every licence checked at package level (D1).
- [ ] C2 — the four widened vocabularies, with `go-ts-vocabulary-parity.spec.ts` green in the same
      commit.
- [ ] C3 — a `.proto` and reflection produce the same `Schema` for the same file; a
      reflection-less server yields `E_GRPC_SCHEMA`; **two same-package sources both resolve and
      nothing panics** (F14); every one of F12's nine target strings behaves as the table says.
- [ ] C4 — a non-`OK` status returns `err == nil` with a populated code (D16); a cancelled stream
      keeps the messages it got (F8); 500 messages coalesce into batches with contiguous `seq`,
      clean under `-race`.
- [ ] C5 — `httpvars/resolve_test.go` and `bridge/http_test.go` pass **unedited**.
- [ ] C6 — `op.SetCommand` receives the unresolved target and method, both times; D10's table
      walked field by field against the implementation, not just read.
- [ ] C7 — the four caps each verified on their boundary; `Adopt` and `SweepOrphans`; an export
      containing a gRPC item is valid v2.1 and reports the skip.
- [ ] C8 — a unary call end to end in the real app against a real local server; the method picker,
      the seeded template, and both metadata groups.
- [ ] C9 — a server-streaming call renders messages as they arrive with real offsets, and Stop
      leaves them in place.
- [ ] C10 — a gRPC request saves into a collection, reopens into a `grpc-request` tab, and its
      history survives Save as… via `Adopt`.
- [ ] C11 — the seven UI tests, each passing twice in a row; `docs/ARCHITECTURE.md` updated
      **including the explicit corrections of P9 OQ-9 and P10 OQ-8**.
- [ ] §6.1's full command set green, including `-race`, the four-chunk check and both bindings
      checks.
- [ ] §6.6's regression list, the two `git diff`/`grep` checks in particular.
- [ ] §6.5's six real-hardware/real-network steps — none runs in this sandbox; each recorded with
      what was measured or reasoned instead.

---

## 8. Open questions, handed forward

**OQ-1 — Client-streaming and bidirectional calls are reachable but not built** (D8, §0.2). F5
verified all four shapes work through `conn.NewStream` and a `grpc.StreamDesc`, so the Go side is
already ~90 % there: what is missing is a UI for a half-open call — a *Send* affordance that adds
another message while the stream is live, a *Half-close* action, and an interleaved log that shows
sent and received messages in one ordered list rather than two panes. That log is arguably the right
shape for *all four* call kinds, which is the reason not to build it as an afterthought: whoever
adds client-streaming should reconsider the Messages pane's shape, not bolt onto it.

**OQ-2 — A saved gRPC request does not carry its schema, so opening one needs the server up (or the
`.proto` still on disk)** (D4). Persisting a compiled `FileDescriptorSet` per saved request would
fix that and is genuinely useful for a request shared through a collection — but it is derived data
that goes stale silently, it is large (a real service's transitive descriptor set is routinely
hundreds of kilobytes), and a stale schema disagreeing with a live server is a worse failure than a
refetch. If it is built, it should be an explicit *"pin this schema"* action with a visible
pinned-at date and a one-click refresh, not an invisible cache.

**OQ-3 — There is no gRPC timeline, and P10's mechanism is not the one to build it from** (D14, F7).
`httptrace` fires nothing for a gRPC call; `grpc/stats.Handler` is the equivalent and reports
per-message wire lengths, header/trailer boundaries and one connection bracket, but no DNS/connect/
TLS split at all. So a gRPC timeline would be a *message* timeline plus a single "connection
established" bar — a different object from `TimelinePane.vue`'s five-phase hop waterfall, and worth
building only if someone actually asks *"where did the time go"* about a gRPC call. The per-message
arrival offsets D14 already shows answer most of that question.

**OQ-4 — There is no "trust this certificate anyway" escape hatch** (D6, §0.2). P2 D4's
*"verification is always on, with no per-request opt-out"* is a good rule and this phase kept it,
covering the real cases with a plaintext toggle and a CA-file field. The case it does not cover is a
developer against a server with a certificate they cannot get the CA for. If it is ever built it
should be per-request, off by default, visibly marked in the UI while active, and **never**
persisted into a collection export — which makes it a design question, not a checkbox.

**OQ-5 — Binary (`-bin`) metadata is not surfaced.** gRPC's own escape hatch for a non-ASCII
metadata value is a `-bin`-suffixed key whose value is base64 on the wire (F6 measured that a
non-ASCII value on a *non*-`-bin` key is accepted by the client and silently mangled rather than
rejected, which is the failure mode). Surfacing it needs a per-row encoding selector and a base64
editor; nothing in this phase produces or consumes one.

**OQ-6 — Four tables now share one insert-then-trim-then-sweep pattern, and none of them shares
code** (D11). `filter_history`, `http_variable_history`, `http_response_history` and now
`grpc_call_history` each carry their own copy of a per-scope count trim, and the last two also carry
a window-function byte sweep. A fourth application is following a precedent rather than duplicating
an abstraction — but P12 is already reading every one of these files for its separability audit and
is the natural place to decide whether a `repos/capped.go` helper earns its keep. Related: P8 D12's
compare dialog is HTTP-only, and comparing two gRPC calls would want the same treatment.

**OQ-7 — This is the app's largest single dependency addition, and only part of it is separable**
(F15). ≈14.2 MB of binary, the same order as the five biggest database drivers combined. If binary
size ever becomes a real constraint, `protocompile` (the `.proto` source path) is the only piece
that could be dropped without losing the feature — reflection-only gRPC would still work — and it is
roughly a megabyte of the total. The rest, `grpc` plus `protobuf`'s dynamic/JSON/descriptor
machinery, is the feature.

**OQ-8 — A `ClientConn` is built and closed per call, so nothing is reused between calls to the same
target** (D7, F16). `grpc.NewClient` is lazy so the construction is free, but the TCP and TLS
handshake is paid on every call — the exact cost P10 F7 measured for HTTP (5.7× on a real endpoint)
and that `httpclient`'s package-level shared client exists to avoid. Pooling would need a key
covering the target, the TLS config *and* the metadata that authenticated the connection, and that
key would contain a resolved secret (§0.3) — solvable, but a real design question rather than a
cache. Worth doing the first time someone notices the latency, with a measurement rather than by
analogy.

**OQ-9 — A gRPC response message or trailer can carry a server-issued credential, and it is
persisted in the clear** (D10). This is the same exposure P8 OQ-6 recorded for an HTTP response body
and P10 OQ-5 extended to per-hop headers: the masking replacer knows *user* secrets and has no way
to recognise a server-issued one. It stays open with those two, now naming a third and fourth field
it reaches. Whoever closes P8 OQ-6 should close all of them together.

**OQ-10 — There is no per-request deadline field** (D15). A gRPC call has no default timeout here,
deliberately, because a subscription stream is legitimately open-ended and `httpclient`'s 30 s would
be a bug rather than a safeguard. But a *unary* call against an unresponsive server now hangs until
the user presses Stop, where the HTTP tab would have given up. An optional per-request deadline —
which maps directly onto `context.WithTimeout` and onto gRPC's own `grpc-timeout` header — is the
right fix and is small; it is left out because choosing its default (none? 30 s for unary only?) is a
product judgement this phase would be making unilaterally.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/events.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/collections.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/ipcerr/ipcerr.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpvars/resolve.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/client.go`
- `/home/user/kira-studio/apps/kira-studio/internal/adapterhost/host.go`
- `/home/user/kira-studio/apps/kira-studio/internal/appcore/deps.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/migrations/0008_p8_response_history.sql`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/response_history.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/collections.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/model/collections.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/model/tabs.go`
- `/home/user/kira-studio/apps/kira-studio/internal/postman/write.go`
- `/home/user/kira-studio/apps/kira-studio/main.go`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/bridge/control.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/state/tabKinds.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/workbench/tabViews.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/state.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/state/collections.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/menus.ts`
- `/home/user/kira-studio/apps/kira-studio/tests/ui/support/mockRuntime.ts`
- `/home/user/kira-studio/apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts`
- `/home/user/kira-studio/packages/shared/domain/http.ts`
- `/home/user/kira-studio/packages/shared/domain/tabs.ts`
- `/home/user/kira-studio/packages/shared/domain/collections.ts`
- `/home/user/kira-studio/biome.json`
