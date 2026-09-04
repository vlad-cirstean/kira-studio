# P9 — Raw request/response inspector and raw request editor

> **What this phase is.** `docs/v1.2/SPEC.md`'s P9 row: **view the exact bytes sent and received
> for a request** (not the structured/parsed model P2's builder presents), and **author/edit a
> request at that raw level directly**. Its "why here" column places it as *"advanced-debugging
> capability that sits on top of the structured request/response model P2-P3 establish"*.
>
> **What does not land here.** The DNS/connect/TLS/TTFB timeline (P10), gRPC (P11), the module
> rename and package split (P12), the UI-consistency pass (P13). Also explicitly not here: storing
> a rendered exchange alongside a P8 history entry (D7, OQ-2), a raw view for a send that *failed*
> (D14, OQ-7), a secret-reveal gate on the raw pane (D6, OQ-4), a live two-way raw request pane
> (D8, OQ-5), and raw editing of `formdata`/`file` bodies (D10, OQ-6). Nothing here is half-built
> toward any of them (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not
> half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from P2's/P7's/P8's prose.**
> Base: branch `claude/feature-v1-2` at `74f691c` (*"docs(architecture): response history, its
> three caps, and the fourth lazy chunk"*). File:line citations point at that content. **Thirteen
> questions that decide this phase's whole shape cannot be answered by reading `net/http` — they
> were answered by running Go against real servers, a real TLS server, a real HTTP/2 server, a
> hand-written CONNECT proxy and a hand-written forwarding proxy** (F2–F10, F14). Those probes were
> a throwaway module, deleted before commit; each finding below records what was run and what came
> back.
>
> **The one-sentence design.** The honest answer to *"the exact bytes sent"* is that Go can produce
> them **exactly** for the request half and **never** for the response half — `httputil.
> DumpRequestOut` was measured byte-for-byte identical to the wire (F7) while `http.Response`'s
> header map has already destroyed received order and case before any code of ours runs (F1, F10)
> — so "raw" is **rendered in Go from the real `*http.Request` and `*http.Response`, labelled with
> its own fidelity**, and the raw *editor* is a third representation of tab state beside the
> builder and curl, parsed and generated in pure renderer TypeScript exactly as P7 does.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/httpclient/wire.go` | **new** — `WireExchange`, `renderRequest`, `renderResponseHead`, the body elision and the two caps (D4, D5) |
| `apps/kira-studio/internal/httpclient/wire_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/httpclient/client.go` | the one `DumpRequestOut` call, the fidelity classification, `Response.Wire` (D2, D3) |
| `apps/kira-studio/internal/httpvars/resolve.go` | `ResolveRequest` gains a fourth return: the secrets it actually substituted (D6) |
| `apps/kira-studio/internal/httpvars/resolve_test.go` | one case for that return |
| `apps/kira-studio/internal/bridge/http.go` | the masking replacer; `Wire` stripped before `Record` (D6, D7) |
| `apps/kira-studio/internal/storage/repos/response_history.go` | one line — `Response.Wire = nil` before marshalling (D7) |
| `apps/kira-studio/internal/storage/repos/response_history_test.go` | one case asserting a stored snapshot carries no `wire` |
| `packages/shared/domain/http.ts` | `HttpWireExchange`; `HttpResponseWire.wire`; `httpResponsePaneSchema` gains `'raw'` (D12, D13) |
| `apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue` | the fourth segment and its branch (D12) |
| `apps/kira-studio/frontend/src/views/httprequest/RawExchangePane.vue` | **new** — the inspector (D12, D15) |
| `apps/kira-studio/frontend/src/http/raw/generate.ts` | **new** — tab state → raw HTTP/1.1 text (D9) |
| `apps/kira-studio/frontend/src/http/raw/parse.ts` | **new** — raw HTTP/1.1 text → tab state (D10, D11) |
| `apps/kira-studio/frontend/src/http/state/raw.ts` | **new** — the dialog's store (D8) |
| `apps/kira-studio/frontend/src/http/EditRawRequestDialog.vue` | **new** — the editor (D8) |
| `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue` | the toolbar button, the palette command registration |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | one `http.editRaw` palette entry |
| `apps/kira-studio/frontend/src/App.vue` | the dialog mount, beside `ImportCurlDialog` |
| `apps/kira-studio/tests/unit/http-raw-parse.spec.ts` | **new** — §6.3 |
| `apps/kira-studio/tests/ui/http-raw.spec.ts` | **new** — §6.4 |
| `docs/ARCHITECTURE.md` | the wire-rendering paragraph, the fidelity table, the corrected `(P7)` pointer at `:1016` |

### 0.2 Out of scope, explicitly

- **P10–P13's own rows**, listed in the header blockquote.
- **Any change to `sharedClient` or its `*http.Transport`.** F3/F4/F5 are the whole argument: every
  mechanism that could capture real wire bytes requires a custom dialer, and a custom dialer
  **silently turns HTTP/2 off** (F3, measured). This phase does not change what goes on the wire in
  order to look at it. §3 states this as the phase's central declined option, not an omission.
- **Genuinely-captured wire bytes.** D2 decides this against four measurements. OQ-1 records the
  exact shape a future opt-in capture mode would take and what it would cost.
- **Persisting a rendered exchange.** D7 — live-only, stripped before P8's `Record`, no migration,
  no new column, no new table. OQ-2 hands the question on with P8 OQ-2's own budget problem.
- **A second reveal gate.** D6 masks by construction and points at P7's existing gated *Copy as
  curl* rather than building a second reveal loop. OQ-4.
- **A live, always-on raw request pane** (a fourth `requestPane` segment). D8 — the editor is
  modal. OQ-5.
- **Raw editing of a `formdata` or `file` body.** D10 — disabled with a stated reason, not
  half-supported. OQ-6.
- **Any new bound method, any new bound service, any new op kind, any new tab kind, any new
  migration.** §3 establishes why none is needed: the rendering rides back on the send result that
  already crosses the bridge.

### 0.3 Ground rules

- **A secret's plaintext must never reach `kira.sqlite`, and must not reach a copyable surface
  ungated.** P5 D6/F3 drew the first line (`bridge/http.go:70-74`) and P7 D10 drew the second (a
  generated curl command is masked until a `localauth` reveal). A rendered request is *both* — it
  is a persisted-adjacent payload (it rides on the object P8 stores, F12) **and** a copyable text
  surface. D6/D7 apply both existing rules rather than inventing a third posture.
- **"Raw" must never claim a fidelity it does not have.** The SPEC says *"the exact bytes"*; the
  measurements say that is achievable for one half and impossible for the other. Every rendering
  this phase produces carries a `fidelity` value and the pane renders a sentence for it (D3, D14).
  A tool that quietly shows HTTP/1.1 text for an HTTP/2 exchange is worse than no tool.
- **`http/**` may not import `views/**`** (`biome.json:127-147`, P1 D7), while `views/** →
  http/**` is permitted and already used (`HttpRequestView.vue:5-9`). F16 decides every placement
  question in §4 from that rule.
- **The renderer never re-derives what Go knows.** The request rendering is Go's because only Go
  knows what the transport added — `Accept-Encoding: gzip`, the computed `Content-Length` of a
  two-pass multipart body, the `Host` a `Host:` header override redirected into `req.Host`
  (F7, F14). A renderer-side reconstruction would be a plausible-looking guess, which is the exact
  failure mode this phase exists to remove.

---

## 1. What the code does today

### 1.1 The request is built in Go, and the structured model never sees what the transport adds

`httpclient.Send` (`client.go:210-346`) is the whole outbound path. In order: `validMethods`
lookup, `resolveURL` (`:137-156`, defaulting a scheme-less URL to `https://`), the form-data
boundary resolution (`:228-239`), `buildBody` (`:241`), `http.NewRequestWithContext` (`:246`), the
explicit `Body`/`GetBody`/`ContentLength` assignment (`:256-260`, F4/F5's own note that
auto-detection only recognises three reader types), the header loop with its `Host` special case
(`:264-274`, F20a: *"net/http silently ignores `Header.Set("Host", …)`"*), the `User-Agent` default
(`:275-278`), D7's `Content-Type` precedence (`:289-300`), and finally `sharedClient.Do` (`:303`).

Four facts that only exist on the Go side of that function, and that no renderer-side
reconstruction can know:

1. **`Accept-Encoding: gzip`** is added by the transport, and only when the caller set none
   (`:279-282`'s own comment).
2. **`Content-Length`** for a `formdata` body is `multipartLength`'s dry run (`body.go:253-276`) —
   an exact count over a fixed boundary's deterministic framing, computed without reading a single
   file byte.
3. **The boundary itself** is minted at `client.go:237` when the user set no `Content-Type`, or
   lifted out of theirs when they did (`:230-236`).
4. **`Host`** is `req.Host` when a `Host:` header was typed, and `u.Host` otherwise.

### 1.2 The response's header order and case are destroyed before any code of ours runs

`flattenHeaders` (`client.go:184-197`) sorts `resp.Header`'s keys and emits one `Header{Name,
Value}` per value. `Header`'s own doc comment (`:54-56`) says so plainly:

> *"Response headers come back sorted by name, one entry per value so duplicates survive — F19's
> honest substitute for net/http's order-losing, key-canonicalising map; **there is no stdlib
> access to the bytes as received**."*

`docs/ARCHITECTURE.md:1009-1017` records the same limitation as a standing property and hands it
forward:

> *"A byte-level raw inspector, the phase that could recover the wire bytes directly (P7), is the
> one that can lift this if it ever matters."*

That pointer is **stale in two ways**: the phase is P9, not P7, and — per F1–F10 below — this phase
measured that the lift is not available at an acceptable cost. C9 corrects both.

### 1.3 The response is runtime-only, and P8 stores a copy of it

`views/httprequest/state.ts:130-131` states P2 D6's rule verbatim: *"the response is runtime-only,
never persisted"*, with `registerTabRuntimeCleanup` deleting the record when the tab closes
(`:147-149`). P8 then added the one place a response **is** persisted:
`bridge/http.go:100-111` calls `ResponseHistory.Record(...)` with `Response: resp`, and
`repos/response_history.go` marshals the whole `httpclient.Response` into `snapshot_json`. **Any
field added to `httpclient.Response` therefore lands in `kira.sqlite` on every send** — F12, and
the reason D7 exists.

### 1.4 There are already two representations of a request beside the builder, and both are pure TypeScript

P7 shipped `http/curl/generate.ts` (112 lines, tab state → a curl command) and
`http/curl/parse.ts` (538 lines, a curl command → tab state), plus `http/curl/tokenize.ts` and
`flags.ts`. P7 D2 states the rule they follow, and it is directly load-bearing for this phase:

> *"**Parse** produces tab state, which Go treats as opaque `json.RawMessage` by design. A Go
> parser would have to ship its result back across the bridge to become the very thing Go refuses
> to model. **Generate** must substitute secrets and dynamic values [and] a Go generator would be a
> second bound method holding a fully-resolved, credential-bearing request."*

`ImportCurlDialog` applies its parse to a **fresh** tab (`state/curl.ts:92-99` —
`openHttpRequestTab()` then `patchHttpRequestTabState`), deliberately never the tab the user is
mid-edit on. `CopyAsCurlDialog` computes a frozen resolution once on open (`state.ts:235-253`'s
`resolveForExport`) and reveals secrets through `revealSecretValues` (`state/curl.ts:211-229`), one
`revealVariable` call per deferred name.

### 1.5 The word "raw" is already taken, twice

- `httpResponseViewSchema` (`http.ts:177`) is `z.enum(['pretty','raw'])` — the response **body**'s
  formatting toggle (`ResponsePane.vue:95-102`, `RESPONSE_VIEW_OPTIONS`).
- `httpBodyModeSchema` includes `'raw'` — P3's plain-text request body mode
  (`body.ts`'s `BODY_MODE_OPTIONS`, labelled *"raw"*, *"Plain text"*).

Neither means "the wire". D12 resolves the collision rather than renaming either.

### 1.6 There is no wire-level code anywhere in the repo

Verified, not assumed. `git grep -n "httputil\|DumpRequest\|DumpResponse\|httptrace\|DialContext\|
DialTLS\|RoundTripper"` over `apps/kira-studio/internal` returns nothing outside vendored module
cache paths. `net/http/httputil` and `net/http/httptrace` are both unused today; `sharedClient`'s
transport sets exactly one field, `Proxy` (`client.go:42-47`).

---

## 2. Findings

### F1 — The response half's fidelity ceiling is set by `net/http`, not by this app
§1.2. `http.Response.Header` is a `map[string][]string` with `textproto.CanonicalMIMEHeaderKey`
applied by the transport before `Do` returns. Order is gone; original case is gone; only
multiplicity survives. Nothing this phase can do inside `httpclient.Send` recovers either, because
the loss happens in the transport's own reader. F10 measures exactly how far the reconstruction is
from the wire.

### F2 — *Verified by running it*: the app's transport already speaks HTTP/2 to real servers
A throwaway module (deleted before commit) built `&http.Transport{Proxy: http.ProxyFromEnvironment}`
— `sharedClient`'s configuration, field for field — and issued a real request:

```
google.com resp.Proto="HTTP/2.0"  TLSNextProto=[h2 unencrypted_http2]
```

and separately, against a local `httptest` server with `EnableHTTP2`, `resp.Proto="HTTP/2.0"` with
the handler itself reporting `r.Proto == "HTTP/2.0"`.

**This is the single most important fact in the phase.** `http.Transport.onceSetNextProtoDefaults`
bundles HTTP/2 automatically when `TLSClientConfig` is nil and no custom dialer is set — which is
exactly `client.go:42-47`. So a large fraction of real HTTPS requests from this app **have no
HTTP/1.1 wire bytes at all**: they are HPACK-compressed binary frames on a multiplexed connection.
"The exact bytes sent" for such a request is not a thing a user would want to read.

### F3 — *Verified by running it*: any custom dialer silently disables HTTP/2
Same module, five transports, each issued one request, then `TLSNextProto`'s key set was read back
(the map `onceSetNextProtoDefaults` populates on first `RoundTrip`):

| transport | `TLSNextProto` after one request |
|---|---|
| `{Proxy}` — today's | `[h2 unencrypted_http2]` |
| `{Proxy, DialContext}` | `[]` |
| `{Proxy, DialContext, ForceAttemptHTTP2}` | `[h2 unencrypted_http2]` |
| `{Proxy, DialTLSContext}` | `[]` |
| `{Proxy, DialTLSContext, ForceAttemptHTTP2}` | `[h2 unencrypted_http2]` |

So installing a byte tee — the only way to capture real wire bytes — **changes the protocol the app
negotiates** unless `ForceAttemptHTTP2` is also set. A debugging feature that silently downgrades
every HTTPS request to HTTP/1.1 changes the thing it claims to observe, including what the server
sends back (different framing, different header compression, no multiplexing, and for some servers
a materially different response).

### F4 — *Verified by running it*: and with `ForceAttemptHTTP2`, a TLS tee either breaks the connection or captures frames
Same module: `DialTLSContext` + `ForceAttemptHTTP2` against an h2-enabled `httptest` server,
returning a `net.Conn` wrapper that tees writes and reads. The handshake reported
`alpn="h2"`, and then:

```
http2: server: error reading preface from client: bogus greeting "GET /x HTTP/1.1\r\nHost: 1"
Get "https://…": net/http: HTTP/1.x transport connection broken: malformed HTTP response
  "\x00\x00\x1e\x04\x00\x00\x00\x00\x00…"
```

The transport could not see that ALPN had chosen h2, because the wrapper does not satisfy the
`ConnectionState() tls.ConnectionState` interface the transport probes for — so it spoke HTTP/1.1
into an h2-only connection and the exchange failed outright. A wrapper that *does* impersonate
`*tls.Conn` would be handed to the http2 layer, and the bytes it tees would then be exactly the
frame stream in the error above: not something a raw inspector can usefully render as text.

**Both branches are dead ends**, and this was a run, not a reading.

### F5 — *Verified by running it*: behind a proxy, the TLS capture hook never fires and the plain hook sees ciphertext
`client.go:44` sets `Proxy: http.ProxyFromEnvironment` — so a user with `HTTPS_PROXY` set (every
corporate network, and this very sandbox) goes through CONNECT. Against a hand-written CONNECT
proxy, with **both** `DialContext` and `DialTLSContext` installed:

```
DialContext fired for addr=127.0.0.1:46623   (the PROXY's address)
DialTLSContext fired 0 time(s)
proxied conn 0 WROTE 505 bytes:
  "CONNECT 127.0.0.1:44113 HTTP/1.1\r\nHost: …\r\nUser-Agent: …\r\n\r\n\x16\x03\x01\x00\xe2\x01…"
```

That is the CONNECT preamble followed by a TLS ClientHello. Go's `connectMethod.scheme()` returns
the *proxy's* scheme, so `hasCustomTLSDialer()` is never consulted for a proxied https target and
the transport does its own `addTLS` internally, out of reach. **For every proxied HTTPS user, a
conn-level tee yields ciphertext and nothing else** — the case is not degraded, it is absent.

### F6 — *Verified by running it*: connection reuse interleaves two exchanges on one tee
Two sequential requests to the same host over a `DialContext` tee produced **one** dialled
connection, and the buffer contained both request-response pairs concatenated. `httptrace.
ClientTrace`'s `GotConn` did hand back our own wrapper (`GotConn is *teeConn = true`, for both the
plain and the TLS dialer), so de-interleaving *is* possible — but it means a third mechanism
(trace installation, per-conn sink swapping, sink clearing on body close) to get right, on top of
F3's protocol downgrade and F5's proxy hole. Recorded so the option is declined on its full cost,
not on a caricature.

### F7 — *Verified by running it, and the decisive finding*: `httputil.DumpRequestOut` is byte-identical to the wire
The same request (`POST`, a query string, an explicit `Content-Length`, four headers including a
duplicated `X-Multi`) was (a) dumped with `httputil.DumpRequestOut(req, true)` and (b) sent through
a `DialContext`-teed transport to a real `httptest` server. Both were **218 bytes and the identical
string**:

```
POST /v2/orders?a=1&b=2 HTTP/1.1\r\nHost: 127.0.0.1:40129\r\nUser-Agent: Kira Studio/1.2.3\r\n
Content-Length: 7\r\nAlpha: a\r\nContent-Type: application/json\r\nX-Multi: one\r\nX-Multi: two\r\n
Zeta: z\r\nAccept-Encoding: gzip\r\n\r\n{"a":1}
```

Three properties this establishes, each of which a reconstruction would have got wrong:

- **Ordering is Go's, not the user's**: `Host`, then `User-Agent`, then every other header
  **alphabetically** (`Alpha`, `Content-Type`, `X-Multi`, `Zeta`), then the transport's
  `Accept-Encoding`. The builder's own row order is *not* what goes out — so a "raw view" rendered
  from the headers table in the user's order would be a plausible lie. This is also the honest
  answer to the brief's *"these differ for things like header ordering"*: they differ, and the
  wire's order is the sorted one.
- **`Accept-Encoding` is not duplicated**: a request that sets `Accept-Encoding: identity` dumps
  with `identity` in its sorted position and **no** appended `gzip` — the same conditional the
  transport applies (`client.go:279-282`).
- **Duplicate header values survive in insertion order** (`X-Multi: one` then `two`).

`DumpRequestOut` is byte-identical *because* it is not an imitation: it runs the request through a
real `http.Transport` writing to an in-memory pipe, i.e. through the very `Request.write` the real
send uses.

### F8 — *Verified by running it*: dumping immediately before the real send is safe, including for a non-rewindable body
`DumpRequestOut(req, false)` was called on a request whose `Body` is an `io.PipeReader` — exactly
the shape `streamFormData` hands `net/http` (`body.go:285-328`) — and the request was then sent
with the *same* `*http.Request`. The server received all 32 bytes intact. With `body=true` the
dump instead buffers the whole body through `httputil.drainBody` and replaces `req.Body` (verified:
a pipe body read back complete afterwards), which is correct but would mean **holding an entire
file upload in memory** for a debugging view.

So D4's rule is decided by measurement: dump the **head** with `body=false`, and compose the body
separately under a cap.

### F9 — *Verified by running it*: a proxied plain-http request's wire target is absolute-form; the dump's is origin-form
Against a hand-written forwarding proxy, the wire read
`GET http://127.0.0.1:46467/thing HTTP/1.1` (and the proxy's own `req.RequestURI` confirmed it),
while `DumpRequestOut` for the identical request wrote `GET /thing HTTP/1.1`. Every other byte
matched. So the request rendering is exact except for the **request-line's target** when a proxy is
in play for a plain-http URL — one line, and D3 labels it rather than hiding it.

### F10 — *Verified by running it*: `DumpResponse` is a reconstruction, and here is exactly how far off
Against a plain-HTTP server that set three headers including a deliberately lower-cased one:

```
WIRE:          HTTP/1.1 200 OK\r\nX-A: 1\r\nX-B: 2\r\nx-lower-Case: v\r\nDate: …\r\n
               Content-Length: 5\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n
DumpResponse:  HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/plain; charset=utf-8\r\n
               Date: …\r\nX-A: 1\r\nX-B: 2\r\nX-Lower-Case: v\r\n\r\n
```

Alphabetised, and `x-lower-Case` canonicalised to `X-Lower-Case`. And for a response that actually
arrived over HTTP/2, `DumpResponse` writes `HTTP/2.0 200 OK` followed by **HTTP/1.1-style header
lines** — an honest status line over a framing that never existed. So the response head is always a
rendering, and D5/D14 say so in the pane.

### F11 — `ResolveRequest` already knows which secrets it substituted
`httpvars/resolve.go:178-187` builds `resolvedNames map[string]bool` for its own Debug log
(`:224-230`, *"the count and the names of the secrets resolved, never their values"*), and holds
`secretValues` (`:170`) in the same scope. So handing back the name→value pairs it actually used is
a return-value change, not new machinery — and D6's masking replacer needs exactly that pair set.

### F12 — Anything added to `httpclient.Response` is persisted by P8, on every send
§1.3. `bridge/http.go:100-111` passes `resp` whole to `ResponseHistory.Record`, and
`repos/response_history.go` marshals it into `snapshot_json`. This is not hypothetical: a rendered
request contains the full `Authorization` header value, so an unstripped field would write a
credential into `kira.sqlite` on every send and undo P5's entire `value`/`secret_value` split — the
precise failure P8 F3 was written to prevent, arriving from a new direction. D7 strips it, and
§6.2 tests that it is stripped.

### F13 — *Verified safe*: widening `httpResponsePaneSchema` a second time cannot break a restored tab
`http.ts:174` is `z.enum(['body','headers','history'])`, used at `:213` as `.default('body')`.
P8 F11 established the reasoning for the first widening and it holds unchanged for the second:
every stored value is still a member, and `state/tabKinds.ts`'s `parseState` merge-normalises the
rest. The reverse direction (a tab saved with `'raw'` opened by an older build) is not a case this
app has — it has never shipped.

### F14 — *Verified by running it*: the dump honours the `Host:` override the wire honours
`client.go:266-269` redirects a user-typed `Host:` header into `httpReq.Host` because *"net/http
silently ignores `Header.Set("Host", …)`"*. A request with `URL.Host = 10.0.0.5` and
`req.Host = api.internal.example.com` dumped as:

```
GET /health HTTP/1.1\r\nHost: api.internal.example.com\r\nUser-Agent: …\r\nAccept-Encoding: gzip\r\n\r\n
```

— i.e. the rendering reflects the override, which is exactly the kind of "did my Host header
actually take effect?" question a raw inspector exists to answer, and which the structured headers
table cannot answer at all.

### F15 — The library check for the raw *parser*, with real registry data
Four published candidates, read from the npm registry (`registry.npmjs.org/<pkg>/latest`):

| package | latest | published | licence | shape |
|---|---|---|---|---|
| `http-parser-js` | 0.5.10 | 2025-04-08 | MIT | a `Buffer`-oriented, callback-driven streaming parser, published as a drop-in for Node's own C parser |
| `llhttp` | 1.0.1 | — | MIT | "HTTP parser in LLVM IR" — a build artifact, not a JS API |
| `http-string-parser` | 0.0.6 | 2017-06-05 | MIT | unmaintained for 8 years, no types |
| `http-message-parser` | 0.0.34 | 2019-01-20 | MIT | 5 runtime deps including `concat-stream`, `stream-buffers`, `minimist`; unmaintained for 6 years |

D11 states the requirement none of them meets.

### F16 — The import rules decide every placement question in this phase
`biome.json:127-147` forbids `http/** → project/**` and `http/** → views/**`; `:66-116` forbids
`views/** → workbench/**` and cross-`views/<kind>/**` imports. `views/** → http/**` is permitted
and already used. So:

- **`http/raw/generate.ts` and `http/raw/parse.ts`** are pure logic over `@shared/domain/http` with
  no Vue and no DOM — the identical property `http/curl/*` claims and that makes its corpus test a
  plain import. They belong in `http/`, beside `http/curl/`, and P12 moves the two together.
- **`http/state/raw.ts` and `EditRawRequestDialog.vue`** belong in `http/` because `App.vue` mounts
  the dialog and `App.vue` is workbench-level — P4's own reasoning for `SaveRequestDialog.vue`,
  and P7's for `ImportCurlDialog.vue`.
- **`RawExchangePane.vue`** belongs in `views/httprequest/` because it is mounted from inside
  `ResponsePane.vue` and needs `editor/CodeMirrorHost.vue` and `theme/primitives/`.

### F17 — *Verified safe*: every surface this phase draws already has its primitive
`SegmentedControl` (the fourth response-pane option), `MessageStrip` (the fidelity strip, the
masking note, the elision notes), `EmptyState`, `IconButton`, `AppButton`, `DialogFrame`
(`title`/`width`/`maxHeight`/`testId`), `CodeMirrorHost` (`:doc`/`:language`/`:read-only` — already
used read-only at `ResponsePane.vue:224`), `copyText` (`clipboard.ts`, already used by
`copyCurlCommand`). `@vscode/codicons` ships `file-binary.svg` and `code.svg`. **No
`theme/primitives/` addition, no new dependency of any kind.**

### F18 — *Verified safe*: no new tab kind, no new op kind, no vocabulary-parity edit
The inspector renders inside the existing `'http-request'` tab and the rendering is produced inside
the existing `'http'` op, so `tabKindSchema` / `RENDERABLE_TAB_KINDS` / `TAB_KIND_MODE` /
`tabRecordSchema` / `model.RenderableTabKinds` and `opKindSchema` / `model.opKinds` are all
byte-identical after this phase. `tests/unit/go-ts-vocabulary-parity.spec.ts` reads
`internal/httpclient/body.go`'s `validBodyModes` and `contentTypeByCodeLanguage` literals — neither
is touched (D10 adds no body mode), so it needs no edit.

### F19 — The two "Raw" labels can never be on screen together
`ResponsePane.vue:164` gates the Pretty/Raw body toggle on
`tab.state.responsePane === 'body' && prettyFormat`. The new pane is selected when `responsePane
=== 'raw'`, which makes that `v-if` false. So D12's fourth segment labelled **Raw** and P2's body
toggle labelled **Raw** are mutually exclusive on screen, and neither has to be renamed. Checked
against the template, not assumed.

### F20 — `multipartLength`'s dry run is exactly the machinery D4's elision needs
`body.go:243-276`: `countWriter` + a real `multipart.Writer` pinned to the same boundary writes the
identical part headers the real pass writes, adding each file's already-`os.Stat`'d size instead of
reading it. So rendering a form-data body with **exact framing and elided file payloads** is the
same two-pass trick with a `strings.Builder` in place of the `countWriter` — no new technique, and
`formPartHeader` (`:221-239`) is already factored out for it.

---

## 3. Checked, and not fired

- **No `sharedClient` change, no custom dialer, no `ForceAttemptHTTP2`, no `httptrace`
  installation.** F2–F6 are the argument, in full and measured. This is the phase's central
  declined option and it is declined on four separate measurements, not on effort.
- **No `net/http` fork, no hand-written HTTP/1.1 client.** Writing our own `net.Dial` +
  `tls.Client` + `Request.Write` + `http.ReadResponse` path would give genuine wire bytes for the
  captured case, at the cost of losing connection pooling, proxy support, HTTP/2, and every
  redirect/timeout/cancel behaviour P2 and P3 built on. That is a rewrite of the transport to
  improve one view.
- **No new migration, no new table, no new column.** The rendering is live-only (D7).
- **No new bound method and no new bound service.** The rendering rides back on the send result
  that already crosses the bridge, so `control.ts`'s `httpSend` wrapper gains nothing and
  `tests/ui/support/{ipcChannels,mockRuntime}.ts` gain no channel and no FQN. Compare P8, which
  needed five of each.
- **No `HttpSendArgs` field.** Nothing about the rendering is decided by the renderer.
- **No new op kind and no second Operations-panel row.** The exchange is already one `http` op;
  a rendering is a *detail of* that op. `op.SetCommand` still receives the **unresolved** URL,
  both times (P5 D6/F3, `bridge/http.go:70-75`) — untouched.
- **No `beautify.ts`, `editor/languages.ts` or `CodeMirrorHost.vue` change.** The raw panes render
  `language="plain"` read-only through the existing host; a raw HTTP message is deliberately *not*
  syntax-highlighted (there is no grammar for it in `languages.ts`, and adding one for a view whose
  whole point is literalness would be inventing colour for bytes).
- **No `@codemirror/*` or other package addition.** F15/F17 — nothing is installed by this phase.
- **No `layoutSchema` change and no fourth workbench panel.** The inspector lives inside the
  response pane, under the splitter that already exists (P2 D12/F18).
- **No `menutemplate.go` change and no accelerator.** One palette entry (`http.editRaw`), the same
  view-scoped shape `http.save` and `http.copyAsCurl` already use (`shortcuts/state.ts:28-30`).
- **No `NOTICES.md` change** — that file is scoped to bundled icon assets, and this phase adds no
  asset.
- **No `docs/PERF.md` budget.** Nothing here is on a budgeted path: the rendering is a few
  kilobytes computed once per send, and both views are reached by an explicit click.

---

## 4. Decisions

### D1 — The library check, stated rather than asserted
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Four questions here; three answered "the stdlib already has it", one answered "no,
and here is the requirement".

- **Rendering an outgoing request as HTTP/1.1 text: `net/http/httputil`, adopted.**
  `DumpRequestOut` is stdlib, is already a dependency by definition, and F7 measured it
  **byte-identical** to the wire. Hand-rolling a `Request.write` equivalent would be strictly worse
  at a solved problem, and would drift the moment Go changes a default.
- **Rendering a response head: `httputil.DumpResponse`, adopted**, with F10's measured caveat
  carried into the UI rather than hidden.
- **Capturing real wire bytes: no library, and no hand-rolled mechanism either** — declined
  outright on F2–F6, not on cost. §3.
- **Parsing a hand-edited raw HTTP request in the renderer: hand-written, ~130 lines in
  `http/raw/parse.ts`.** F15 lists the four published candidates with their real registry data;
  two are unmaintained for 6–8 years, one is an LLVM IR build artifact rather than a JS API, and
  `http-parser-js` — the only healthy one — is a `Buffer`-oriented streaming parser published as a
  drop-in for Node's own C parser. **The requirement none of them meets** is the same three-part
  one P7 D1 named for the curl flag walk, and it is not about size:
  1. it must accept **`{{base_url}}/v2/orders`** as a request-target and `{{token}}` inside a
     header value — every conformant HTTP parser rejects a non-URI target, which is precisely the
     text this app's editor must round-trip (D9);
  2. it must preserve header **name case and row order verbatim** so a round trip through the
     dialog does not silently rewrite the user's own headers table — the opposite of what a
     conformant parser does (`textproto` canonicalisation, F1);
  3. it must land on **this app's own** `none|raw|code|urlencoded|formdata|file` vocabulary with
     its `codeLanguage` sub-selector, a vocabulary `http.ts:99-115` explains was *deliberately*
     diverged from Postman's and which no published package can target.
  On top of that, a real parser applies transfer-codings and folds obs-continuations — behaviours
  that would *transform* the user's text, when the entire contract of this editor is that what you
  typed is what you get.

### D2 — "Raw" is **rendered in Go**, from the real `*http.Request` and `*http.Response`
The brief's first question — *is raw a read-only view derived from the structured model, or does Go
need to capture genuinely-as-sent bytes?* — has a third answer, and it is the right one.

**Not derived from the structured model**, because the structured model does not contain the
answer: §1.1's four transport-added facts (`Accept-Encoding`, the computed multipart
`Content-Length`, the minted boundary, the `Host` override) exist only inside `httpclient.Send`,
and F7/F14 measured that the dump reflects all of them. A renderer-side reconstruction from the
headers table would also emit the user's row order, which F7 measured is **not** the wire's order.

**Not captured from the wire**, because F2–F6 measured that capture is unavailable for the majority
case (HTTP/2, F2), unavailable behind a proxy (F5), changes the protocol when installed (F3),
breaks or yields frames under h2 (F4), and needs a third mechanism for pooled connections (F6).

**Rendered from the real objects**, which is exact for the request half (F7) and an explicitly
labelled reconstruction for the response half (F10). Concretely, `client.go` gains two lines around
the existing `sharedClient.Do`:

```go
// P9 D2/F7: dumped from the request the transport is about to write, with body=false — F8 measured
// that this is safe for a non-rewindable streaming body and that body=true would buffer an entire
// file upload through httputil.drainBody. The body is composed separately, under D4's cap.
reqHead, dumpErr := httputil.DumpRequestOut(httpReq, false)

start := time.Now()
resp, err := sharedClient.Do(httpReq)
```

and the `Response` literal at `:333-345` gains one field. A dump error is never fatal: `Wire` is
left nil and the pane says the rendering was unavailable — a debugging view must never be the
reason a send fails.

### D3 — Fidelity is a value, not a footnote
Three states, computed after `Do` returns because two of the three inputs are only known then:

| `fidelity` | when | what the pane says |
|---|---|---|
| `exact` | `resp.ProtoMajor == 1` **and** no proxy applied to this URL | *"These are the exact bytes this app wrote to the connection."* |
| `http2` | `resp.ProtoMajor >= 2` | *"This exchange used HTTP/2, whose wire form is binary HPACK frames on a multiplexed connection. Shown below is the equivalent HTTP/1.1 form of the same request and response."* |
| `proxied` | proto 1.x and a proxy applied | *"This request went through an HTTP proxy, so its request line carried the absolute URL (`GET http://…`) rather than the path shown."* (F9 — one line differs, and it is named) |

The proxy input is `http.ProxyFromEnvironment(httpReq)` called directly — the same function
`sharedClient.Transport.Proxy` already is (`client.go:44`), so the classification cannot disagree
with what the transport actually did. The proto input is `resp.Proto`/`resp.ProtoMajor`.

**Why a value rather than prose in the docs:** the SPEC asks for *"the exact bytes"*, the
measurements say that is true for one case out of three, and the difference is invisible to a user
looking at plausible-looking HTTP/1.1 text. Making it a field the pane must render is the only
version of this feature that is not quietly misleading.

### D4 — What the rendered **request** contains, and what a body costs
`renderRequest` builds one string:

1. **The head**, verbatim from `DumpRequestOut(httpReq, false)` — exact (F7), including the
   transport's own `Accept-Encoding`, the real `Content-Length`, Go's own header ordering, and a
   `Host:` override (F14).
2. **The body**, per mode, capped at `maxWireBodyBytes = 128 KiB`:

| mode | what is rendered |
|---|---|
| `none` | nothing |
| `raw`, `code` | the buffer verbatim, truncated at the cap with `\n[… N more bytes …]` |
| `urlencoded` | the encoded string `buildURLEncoded` produced — *the encoded one*, since that is what goes out; `url.QueryEscape`'s `+`-for-space is exactly the thing a user comes to a raw view to confirm (`body.go:132-137`'s own note that this deliberately differs from `url.ts`'s query-string encoder) |
| `formdata` | the **exact** multipart framing — same boundary, same `formPartHeader` output, same terminator (F20) — with each file part's payload replaced by `[… 4 194 304 bytes of report.csv …]`, and text parts verbatim under the cap |
| `file` | `[… 4 194 304 bytes of report.pdf …]` alone |

**The `Content-Length` in the head is always the real one**, so an elision never lies about size —
the header says 4 MB and the body region says which 4 MB it was. This is the whole reason to elide
rather than truncate silently.

**Why 128 KiB rather than P8's 256 KiB or the 10 MiB transfer cap:** those two bound *storage*
(*"how much is it worth keeping twenty copies of, forever?"*) and *transfer*. This one bounds a
**per-send bridge payload for a view nobody may open**, and it is paid on every send. A request
body over 128 KiB is essentially always a file or an upload, which D4 already elides; the residue
is a hand-pasted document, excerpted with a visible marker. The stated cost: pasting a 300 KB JSON
body and opening Raw shows the first 128 KB and says so.

### D5 — What the rendered **response** contains, and what it deliberately does not duplicate
`renderResponseHead` emits the status line and headers from `resp` — F10's measured reconstruction,
alphabetised and canonicalised, with a `note` in the pane saying exactly that and pointing at F1's
cause. It does **not** include the body.

**The body is not duplicated across the bridge**: `ResponsePane.vue` already holds
`response.body`, so `RawExchangePane.vue` renders `responseHead + "\n" + response.body` locally.
Duplicating a 10 MiB body onto a second field so a rarely-opened pane can concatenate two strings
would double the largest payload this bridge carries, for nothing. A base64 body
(`bodyEncoding === 'base64'`, `client.go:321-326`) renders as
`[… 412 KB of binary data …]` in the same shape D4 uses for a file part — consistent with
`ResponsePane.vue:217-223`'s existing refusal to render binary, and the honest answer to P8 OQ-2's
question about whether P9 would make binary bodies renderable: **it does not**, and OQ-2 stays open
with that answered.

### D6 — Secrets: masked by construction, no new gate
The brief's third question — *does the raw editor show pre- or post-substitution text, and does
substitution still apply?* — splits in two, because the inspector and the editor are different
surfaces (D9 answers the editor's half).

For the **inspector**, the rendering is made from the *resolved* request, so it contains every
secret's plaintext. That is a copyable text surface, which is exactly the situation P7 D10 already
ruled on for a generated curl command. So the same posture applies, implemented at the point where
the values are already known (F11):

- `httpvars.ResolveRequest` gains a fourth return, `used map[string]string` — the secret **names →
  values it actually substituted**, which it already tracks the names half of (`resolve.go:178-187`).
- `bridge/http.go` builds `strings.NewReplacer(value1, "{{name1}}", …)` from it and applies it to
  `resp.Wire.Request` only.
- The pane renders a `note` strip: *"2 secret values are shown as `{{name}}`. Use **Copy as curl**
  to produce a command with real values (authentication required)."*

**Two honest properties, stated rather than discovered:**

- **Over-masking is possible; under-masking is not.** If a secret's plaintext happens to occur
  literally elsewhere in the request, that occurrence is masked too. That is the safe direction,
  and it is the direction a replacer naturally fails in.
- **The masked spans differ in length from what was sent**, so a `Content-Length` may not match the
  visible body byte count when a secret sits inside the body. The header is the truth; the pane
  says so in the same strip.

**No reveal loop is built here.** P7's `revealSecretValues` (`state/curl.ts:211-229`) already
exists, is already gated by `localauth`, and already produces a fully-resolved command. Building a
second five-step reveal against a second surface is the duplication `docs/v1.2/SPEC.md`'s own
module-boundary section warns about (*"a reveal-gate flow … belongs in its own shared package the
first time a second consumer is foreseeable"*) — P5 OQ-2 and P12 own that extraction. OQ-4.

### D7 — The rendering is live-only, and is stripped before it can be stored
F12: `httpclient.Response.Wire` would otherwise be marshalled into `snapshot_json` on every send.
Two changes, both one line:

```go
// repos/response_history.go, in Record, before marshalling:
// P9 D7/F12: the rendered exchange is live-only. It is the resolved request in text form, and
// even masked (P9 D6) it would double a snapshot's size for a pane that cannot be opened from a
// stored entry anyway.
rec.Response.Wire = nil
```

and `Wire *WireExchange` is a **pointer** with `json:"wire,omitempty"`, so a stored snapshot's JSON
does not even carry the key.

**The stated consequence:** selecting a past response from the History pane and switching to Raw
shows *"No raw view for a stored response — the raw exchange is kept only for the response
currently in this tab."* That is the same lifetime P2 D6 gave the response itself, applied to a
strictly larger payload, and it is visible rather than silent. OQ-2 records what storing it would
need (a separate budget, per P8 OQ-2's own arithmetic).

### D8 — The editor is a **dialog**, not a fourth request pane
The brief's second question — *what does "author/edit a request at that raw level" mean precisely?*
— is answered as: **a raw HTTP/1.1 text buffer the user hand-edits, which is parsed back into the
structured model on Apply.** The buffer never becomes a second send path; there is exactly one send
path, and it takes tab state.

**Why modal rather than a persistent `requestPane` segment**, argued rather than asserted:

- A persistent raw pane is a **second source of truth** that must stay in sync with the builder on
  every keystroke in either direction. Typing a header in the Headers table would have to
  regenerate the raw buffer (moving the user's cursor); typing in the raw buffer would have to
  re-parse on every keystroke and patch the tab.
- A hand-edit passes through **unparseable intermediate states** constantly (a half-typed header
  line, a missing blank line). A live pane must decide what the tab's state is at that moment; a
  dialog does not have to, because it parses once, on Apply.
- P7 already established the modal parse-and-apply shape for exactly this problem
  (`ImportCurlDialog`, §1.4), and it works.

**One deliberate difference from Import from curl:** `submitImportCurl` opens a **fresh** tab
(`state/curl.ts:95`) because a pasted command is a new request. **Apply here patches the current
tab**, because this *is* the current request being re-authored. `patchHttpRequestTabState` is the
same call in both cases.

Reached from two places, mirroring `http.copyAsCurl` exactly: an `IconButton` in
`HttpRequestView.vue`'s toolbar beside *Copy as curl*, and a `registerCommand('http.editRaw', …)`
plus one `shortcuts/state.ts` palette entry. No accelerator, no menu template change.

### D9 — The editor's text is **pre-substitution**, and substitution still applies on send
The brief's fourth question, answered directly.

**Pre-substitution.** `http/raw/generate.ts` builds the buffer from `HttpRequestTabState` — the
tab's own text — so `{{base_url}}`, `{{token}}` and `{{$guid}}` appear **literally**. This is not a
preference; a post-substitution buffer is not editable at all: applying it would write today's
resolved values back into the tab and destroy every variable reference the user has. It would also
have to either roll `{{$guid}}` (changing the text the user is looking at, P7 D11's own hazard) or
show a frozen value that then re-rolls at send.

**Substitution still applies on send, unchanged, because Apply lands in tab state first.** There is
no bypass: after Apply the request is an ordinary tab, and `send()` runs the same P5 stage 1 /
Go stage 2 pipeline (`state.ts:156-215`, `httpvars.ResolveRequest`) it runs for a builder-authored
request. A hand-edited `Authorization: Bearer {{token}}` resolves at send exactly as one typed into
the Headers table does. **This is the single most important consequence of parsing back into the
model rather than sending the buffer verbatim**, and it is why D8 chose that shape.

The generated buffer is therefore *not* what D2's inspector shows, and the dialog says so in one
line: *"This is the request as you authored it — `{{variables}}` are resolved when you send. To see
what actually went out, use the response pane's **Raw** view."* Two surfaces, two stages, both
labelled.

### D10 — What the editor accepts, what it refuses, and what a parse produces
**Generated for**: `none`, `raw`, `code`, `urlencoded`.
**Refused for**: `formdata` and `file`. The toolbar button and the palette entry are disabled with
`v-tooltip`: *"A form-data or binary body has no text form that can be edited and parsed back — a
file part is bytes on disk, not text. Its wire form is in the response pane's Raw view."* That is
`AGENTS.md`'s *"scope left out is left out entirely"* — the alternative (generate an elided body
that the parser would then take literally) would silently replace a 4 MB upload with the string
`[… 4194304 bytes of report.csv …]`.

**A parsed body always lands in `raw` or `code`, never in `urlencoded`/`formdata`/`file`.** A raw
message's body is already *serialized*; the three structured modes are editors over a
serialization, and re-deriving one from bytes is a guess (a `+` in a urlencoded value is
indistinguishable from an encoded space at the row level, and a file part's local path is simply
not in the text). The rule is a table over the effective `Content-Type`:
`application/json` → `code`/`json`; `application/xml`,`text/xml` → `code`/`xml`;
`text/html` → `code`/`html`; `application/javascript` → `code`/`javascript`; everything else,
including `application/x-www-form-urlencoded` → `raw`.

**The stated consequence**, warned in the dialog rather than discovered: applying over a
`urlencoded` body converts it to a `raw` body carrying the identical bytes and the identical
`Content-Type` header — **the request that goes on the wire is unchanged**, only the editor for it
is. The dialog shows that as a `warn` strip before Apply is pressed, listing the mode change.

### D11 — The parser: what it accepts, and what it refuses
`http/raw/parse.ts`, pure, no Vue, no DOM, `@shared/domain/http` its only import — the property
`http/curl/*` already has (F16).

The grammar, in full:

1. **Request line**: `METHOD SP target [SP HTTP-version]`. The version is optional and ignored (the
   app speaks whatever the transport negotiates, F2 — accepting `HTTP/1.1` and then possibly
   sending h2 would be the lie D3 exists to prevent, so the field is accepted and dropped rather
   than shown as a promise). The method must be one of `HTTP_METHODS`; anything else is an error
   naming the token, since `httpclient.validMethods` would refuse it at send anyway
   (`client.go:49-52`, `:211-213`).
2. **The target** is taken verbatim, `{{…}}` and all — no `new URL()`, no normalisation, no
   percent-encoding pass. A target beginning `/` is joined onto the tab's existing origin so a user
   can edit just the path; anything else replaces the URL outright.
3. **Header lines** until the first blank line: `name: value`, split at the **first** colon, value
   trimmed of leading spaces only. **Name case and line order are preserved exactly.** A duplicate
   name is a second row, not a merge. An obs-fold continuation line (leading space) is an error
   with a named line number rather than being silently joined — folding is deprecated by RFC 7230
   and joining would rewrite the user's text.
4. **A `Host:` header is kept as a header row**, not folded into the URL — `client.go:266-269`
   already gives it its documented meaning at send time, and moving it would make the round trip
   lossy.
5. **The body** is everything after the first blank line, verbatim, including trailing newlines.
   No transfer-coding is applied and none is accepted: a `Transfer-Encoding: chunked` header
   produces a `warn`, because `body.go`'s `buildBody` always computes an exact `Content-Length` and
   never sends chunked (P3 F5), so honouring it would be a promise this app cannot keep.
6. **A `Content-Length` header is dropped on Apply** with a `note`, because Go computes the real
   one and a stale hand-typed value would be a header the send silently overrides. Same for
   `Content-Length: 0` on an empty body.

Errors are a single `{ error: string }` (P7's `ParsedCurl` shape), warnings a `CurlWarning`-shaped
list so the dialog's `ImportReportStrip.vue` renders them with no change.

**This earns a dedicated unit test** under `AGENTS.md`'s *"a parser/splitter with several
interacting rules"* clause — the same clause P7 D17 invoked — and nothing else in this phase does.

### D12 — The inspector: a fourth response-pane segment, and no renaming
`httpResponsePaneSchema` widens to `z.enum(['body','headers','history','raw'])` (F13), so the
existing `SegmentedControl` becomes **Body · Headers · History · Raw** and the choice persists the
same way the other three do.

The naming collision with `responseView: 'raw'` (§1.5) is resolved by **F19, not by a rename**: the
body's Pretty/Raw toggle is gated on `responsePane === 'body'` (`ResponsePane.vue:164`), so the two
labels are never on screen at once. Renaming either would churn a persisted enum and a P2 test id
for a problem that does not occur.

`RawExchangePane.vue` renders, top to bottom:

- the **fidelity strip** (D3), tone `info` for `exact` and `warn` for the other two;
- the **masking note** when any secret was masked (D6);
- a **request** section: `→ POST /v2/orders` as a caption, then `CodeMirrorHost` read-only,
  `language="plain"`, over `wire.request`, with a **Copy** `IconButton` (`copyText`, F17);
- a **response** section: `←` caption, then `CodeMirrorHost` over `wire.responseHead + "\n" +
  body`, with its own Copy;
- the **received-order note** (D5/F10) under the response section.

When `wire` is null — a stored history entry (D7), or a dump error (D2) — the pane is an
`EmptyState` with the one-line reason.

### D13 — The wire shapes live in Go and are mirrored, not re-validated
`packages/shared/domain/http.ts`, `trust<T>()`d as every bound result already is (P2 D5):

```ts
export type HttpWireFidelity = 'exact' | 'http2' | 'proxied';

export interface HttpWireExchange {
  /** The request as Go rendered it: exact bytes for `exact` (P9 F7), the equivalent HTTP/1.1
   *  form otherwise (D3). Secret values are masked back to `{{name}}` (D6). */
  request: string;
  /** Status line + headers only — the body is not duplicated here (D5); the pane concatenates the
   *  response object it already has. Alphabetised and canonicalised by net/http (F1/F10). */
  responseHead: string;
  fidelity: HttpWireFidelity;
  /** How many distinct secret values were masked in `request` — 0 for a request using none. */
  maskedSecrets: number;
  /** True when a body was elided or truncated in `request` (D4). */
  requestBodyElided: boolean;
}

// HttpResponseWire gains one optional member; every existing consumer is untouched.
//   wire?: HttpWireExchange;
```

`wire` being **optional** is what makes D7's strip a no-op on the TypeScript side and what keeps
`ResponsePane.vue`'s existing computeds byte-identical.

### D14 — What each sentence in the pane actually says
Collected here so the implementation writes prose once, and so review can check it against the
measurements rather than against taste. Each maps to a finding.

| condition | text | source |
|---|---|---|
| `fidelity === 'exact'` | These are the exact bytes this app wrote to the connection. | F7 |
| `fidelity === 'http2'` | This exchange used HTTP/2 — its wire form is binary HPACK frames on a multiplexed connection. Shown here is the equivalent HTTP/1.1 form. | F2 |
| `fidelity === 'proxied'` | This request went through an HTTP proxy, so its request line carried the absolute URL rather than the path shown. Everything else is exact. | F9 |
| always, response section | Response headers are shown alphabetised and in canonical case — Go's HTTP client does not expose them in received order. | F1, F10 |
| `maskedSecrets > 0` | {n} secret value(s) are shown as `{{name}}`. Use Copy as curl for a command with real values (authentication required). | D6 |
| `requestBodyElided` | The request body is shown in part — `Content-Length` above is the real one. | D4 |
| `!wire`, stored entry | No raw view for a stored response — the raw exchange is kept only for the response currently in this tab. | D7 |

### D15 — A failed send has no raw view
`httpclient.Send` returns `(Response{}, err)` on a transport failure (`client.go:304-306`,
`:311-313`), and `bridge/http.go:92-94` returns that error out of the op closure. So there is no
`Response` to hang a `Wire` on, and the pane shows the send error `MessageStrip` that already
exists (`ResponsePane.vue:149-151`).

The request text *is* available at that point (D2 dumps before `Do`), and surfacing it for a failed
connect would be genuinely useful — but threading it out would mean returning a partial success
through `RunOp`'s `(any, error)` contract, i.e. inventing a "successful failure" for one view.
Declined here and recorded as OQ-7 rather than half-built.

---

## 5. Implementation order

Nine commits. C1–C3 add capability with nothing mounted; C4 makes the inspector exist; C5–C7 build
the editor bottom-up; C8–C9 are the tests and the docs. Per `AGENTS.md`, run the fast checks
(`lint`, `typecheck`, `build`) per commit and the expensive suites once at the end.

### C1 — `feat(shared): the raw-exchange domain`
`packages/shared/domain/http.ts`: `HttpWireFidelity`, `HttpWireExchange`, `HttpResponseWire.wire?`,
and `httpResponsePaneSchema` gains `'raw'` (D13/F13). Pure addition — nothing produces or consumes
either yet.

### C2 — `feat(http): render a request and a response as HTTP/1.1 text`
`internal/httpclient/wire.go`: `WireExchange`, `renderRequest` (D4's head + per-mode body, the
128 KiB cap, the multipart elision reusing `formPartHeader`/the boundary, F20), `renderResponseHead`
(D5), and `classifyFidelity` (D3, reading `resp.ProtoMajor` and `http.ProxyFromEnvironment`).
`client.go`: the `DumpRequestOut(httpReq, false)` call before `Do` (F8), and `Response.Wire`.
`wire_test.go` (§6.2). No caller outside the package —
`go test ./apps/kira-studio/internal/httpclient/...` is the whole proof.

### C3 — `feat(bridge): mask a rendered exchange's secrets, and keep it out of history`
`httpvars/resolve.go`'s fourth return (D6/F11) and its test case; `bridge/http.go`'s replacer;
`repos/response_history.go`'s one-line strip and its test case (D7/F12). **The security commit** —
after it, a rendered exchange exists, carries no plaintext secret, and cannot reach `kira.sqlite`.
Still nothing shows it. `scripts/setup.sh` is run here (`ResolveRequest`'s signature changed; no
bound method changed, so bindings are expected to come back **identical** — confirm that rather
than assume it, §6.1).

### C4 — `feat(http): a Raw pane over the exchange just sent`
`views/httprequest/RawExchangePane.vue` (D12/D14/D15) and `ResponsePane.vue`'s fourth segment plus
its branch. **The inspector half of the phase, complete on its own terms** — the SPEC's *"view the
exact bytes sent and received"*, with its fidelity stated.

### C5 — `feat(http): generate a raw HTTP request from the builder's state`
`http/raw/generate.ts` (D9) — pure, tested by C8's unit spec's round-trip half. Nothing mounts it
yet.

### C6 — `feat(http): parse a hand-edited raw HTTP request back into the builder`
`http/raw/parse.ts` (D10/D11) and `tests/unit/http-raw-parse.spec.ts` (§6.3) — the test lands with
its subject, as `repos/response_history_test.go` did in P8 C2.

### C7 — `feat(http): Edit as raw HTTP`
`http/state/raw.ts`, `http/EditRawRequestDialog.vue`, `App.vue`'s mount, `HttpRequestView.vue`'s
toolbar button and `registerCommand('http.editRaw', …)`, `shortcuts/state.ts`'s palette entry, and
D10's disabled cases with their tooltip. **The editor half of the phase.**

### C8 — `test: the raw inspector and the raw request editor`
`tests/ui/http-raw.spec.ts` (§6.4).

### C9 — `docs(architecture): the raw exchange, what it renders and what it cannot capture`
`docs/ARCHITECTURE.md`: a paragraph for the rendering and its three fidelities with F2/F3/F5's
measurements named; the request-half exactness (F7) and the response-half ceiling recorded as
properties; D7's live-only rule beside P8's own storage paragraph; the raw editor's
parse-back-into-the-model contract and its pre-substitution rule (D9); and **the stale pointer at
`:1016` corrected** — it currently promises that *"a byte-level raw inspector … (P7)"* can lift the
alphabetised-headers limitation, which is the wrong phase number and, per F2–F6, the wrong promise.
It becomes a statement that P9 measured the lift and declined it, with OQ-1's shape.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus
`go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`bun run setup` first in a fresh container.

Two bindings checks, both from `AGENTS.md`'s own warnings:

1. C3 changes a **Go-internal** signature (`ResolveRequest`) and no bound service's method set, so
   `apps/kira-studio/frontend/bindings/**` must come back **byte-identical** after
   `scripts/setup.sh` — `git diff --stat apps/kira-studio/frontend/bindings` must be empty.
   Confirm rather than assume: it is the commit that would notice.
2. `httpclient.Response` gains a field, which **does** appear in the generated model. Confirm the
   regenerated `httpservice.ts` still calls `$Call.ByName("…bridge.HttpService.Send", …)` and not
   `$Call.ByID(<n>, …)` — a `-names`-less regeneration breaks **every** `tests/ui` spec at the
   first bound call of boot and nothing about the failure points at bindings.

Also confirm `bun run build` reports the **same four** lazy chunks `docs/ARCHITECTURE.md:28`
records and no fifth — this phase adds no dependency and no `await import()`.

### 6.2 The Go tests
**`internal/httpclient/wire_test.go`** exists because the body rendering is a per-mode dispatch
with a cap and an elision interacting — not because it is a round trip. Six cases:

1. **Exactness, against the wire.** Drive a real `httptest` server through a teed `DialContext`
   *inside the test only* (never in shipped code) and assert `renderRequest`'s head equals the
   bytes the connection received, for a request with duplicate headers, a `Host:` override and a
   user-set `Accept-Encoding`. This is F7/F14 pinned as a regression test rather than a one-off
   measurement — the single most valuable test in the phase, because a future Go release changing
   `Request.write` is exactly what would break the feature silently.
2. **The multipart elision**: a two-text-part, one-file-part body renders the exact boundary and
   part headers `multipartLength` counted, the file payload replaced by its marker, and the head's
   `Content-Length` equal to the real dry-run count (F20).
3. **The 128 KiB cap**: a 300 KiB `raw` body renders 128 KiB plus the marker, and the head still
   reports 300 KiB.
4. **A `file` body** renders head + one marker and reads no file bytes.
5. **Fidelity classification**: proto `1.1` + no proxy → `exact`; proto `2.0` → `http2`; proto
   `1.1` + a proxy function returning a URL → `proxied`.
6. **A base64 response body** renders the binary marker in `responseHead`'s companion rather than
   the bytes (D5).

**`internal/httpvars/resolve_test.go`** gains one case: the fourth return contains exactly the
secret name→value pairs actually substituted, and is empty when the request references none.

**`internal/storage/repos/response_history_test.go`** gains one case: `Record` given a
`Response` with a non-nil `Wire` stores a `snapshot_json` whose decoded response has `Wire == nil`
and whose raw JSON does not contain the substring `"wire"` (D7/F12). **This is a security
assertion, not a CRUD round trip** — it is the test that would catch a future refactor
reintroducing the field.

**Explicitly not tested:** that `DumpRequestOut` works (stdlib), that a `none` body renders nothing,
that the pane's strings are spelled correctly. Each is a one-condition guard or restates a short
function body — `AGENTS.md`'s *"everything else gets nothing"*.

### 6.3 The unit spec — `tests/unit/http-raw-parse.spec.ts`
D11's grammar is *"a parser with several interacting rules"*, so it gets a corpus in the shape
P7's own curl corpus takes. Eight cases:

1. **Round trip**: `generate(state)` → `parse(...)` → a state equal to the original for a `code`
   body, a `raw` body, an empty body, and a request with duplicate and mixed-case headers.
2. **`{{var}}` survives** in the target, in a header name, in a header value and in the body —
   verbatim, in both directions (D9's whole premise).
3. **Header case and order are preserved**, including two rows with the same name.
4. **A leading-`/` target** joins onto the tab's existing origin; an absolute target replaces it.
5. **Content-Type → mode**: the five mappings of D10, including `x-www-form-urlencoded` landing in
   `raw` rather than `urlencoded`.
6. **`Content-Length` is dropped** with a note; **`Transfer-Encoding: chunked`** produces a warning.
7. **An obs-fold continuation line** is an error naming its line number, not a silent join.
8. **Errors**: an unknown method, a request line with no target, a header line with no colon.

### 6.4 The UI spec — `tests/ui/http-raw.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked. Four tests:

1. **The inspector, exact.** Seed an `httpSend` snapshot whose response carries a `wire` with
   `fidelity: 'exact'`; open a request tab, send, switch to **Raw**; assert
   `[data-testid="http-wire-fidelity"]` reads the exact-bytes sentence, that the request section's
   editor contains the seeded request text, and that the response section contains
   `responseHead` **followed by the response body** (D5's local concatenation — a seeded body that
   does not appear is a failing assertion, not a cosmetic one).
2. **The inspector, http2 and masked.** Seed `fidelity: 'http2'` and `maskedSecrets: 2`; assert
   both strips render, the fidelity one with `warn` tone, and that the request text still shows
   `{{token}}` rather than any seeded plaintext.
3. **No raw view for a stored entry.** With a history entry selected (P8's viewing band showing),
   switch to Raw and assert the D7 empty state — and that switching back to Body still renders the
   stored entry, i.e. the fourth segment did not disturb P8's source swap.
4. **The editor.** Open **Edit as raw HTTP…**, assert the buffer contains `{{base_url}}` literally
   (D9), edit it to add a header and change the method, press Apply, and assert the tab's method
   select, headers table and URL field all reflect it — then assert the dialog is disabled with its
   tooltip for a tab whose body mode is `formdata` (D10).

### 6.5 What only a real Mac and a real network can settle
1. **The h2 share in practice.** Send to a handful of real public HTTPS endpoints and record how
   many report `fidelity: 'http2'`. F2 measured that Google does; the *proportion* is what decides
   whether the `http2` sentence is an edge case or the common one, and it is worth knowing before
   P13 styles the strip.
2. **A real corporate proxy** — confirm `fidelity: 'proxied'` fires and that the sentence is the
   right one (F5/F9 used hand-written proxies).
3. **A 2 GB binary body**: confirm the raw view renders instantly with a marker and that memory
   does not spike (F8's `body=false` rule is what makes this true; it is worth watching once).
4. **A real form-data send with two files**: confirm the rendered framing matches what the server
   actually parsed, part for part.
5. **A real secret in a header**: confirm the raw view shows `{{name}}` and that *Copy as curl*
   still reveals through the real Touch ID prompt (the two surfaces must not interfere).
6. **A hand-edited raw request that is then sent**: confirm a `{{var}}` typed in the dialog resolves
   at send exactly as one typed in the builder does (D9's claim, end to end).

### 6.6 What must not regress
- **Studio renders identically.** Nothing in this phase touches `project/**`, `views/grid/**`,
  `views/console/**`, an adapter, or the data plane.
- **Nothing about what goes on the wire changes.** `sharedClient` and its transport are
  byte-identical; `git diff` must show no change to `client.go:42-47`. A send's `resp.Proto` for a
  given endpoint must be the same before and after this phase — the phase observes, it does not
  alter.
- **`tests/ui/http-request.spec.ts`, `http-request-body.spec.ts`, `http-curl.spec.ts`,
  `http-variables.spec.ts`, `http-dynamic-values.spec.ts`, `http-history.spec.ts`,
  `collections.spec.ts` and `mode-switch.spec.ts` all pass unedited.** `wire` is optional (D13), so
  every existing seeded response stays valid with no fixture edit; a spec edit here is a signal the
  pane restructure changed P2/P8 behaviour.
- **`op_log` behaviour is byte-identical.** `op.SetCommand` still receives the unresolved URL, both
  times, and no new op kind exists (F18).
- **`kira.sqlite` gains no column and no table**, and a `snapshot_json` written after this phase is
  the same shape as one written before it (§6.2's third assertion).
- **`bun run test:ipc:fe` passes unedited.** No data-plane frame, adapter or fixture change.
- **No file under `http/**` imports `views/**`**, and no file under `views/httprequest/**` imports
  another `views/<kind>/**` — `bun run lint` is the check (F16).
- **`bindings/**` is unchanged except `httpclient.Response`'s new field** (§6.1).
- **`docs/PERF.md` and `NOTICES.md` are unchanged** — §3.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — the three TS additions; `httpResponsePaneSchema` widened with an existing stored
      `'body'`/`'headers'`/`'history'` value still restoring.
- [ ] C2 — `renderRequest`'s head is byte-identical to a teed wire capture in `wire_test.go` case 1;
      the multipart elision reports the real `Content-Length`; all three fidelities classify.
- [ ] C3 — a rendered request carries `{{name}}` and no plaintext for every secret; a stored
      snapshot's JSON contains no `"wire"` key; `bindings/**` comes back byte-identical.
- [ ] C4 — the fourth segment renders; the fidelity strip shows the right sentence for each of the
      three values; both Copy buttons work; a stored history entry shows D7's empty state.
- [ ] C5/C6 — the corpus round-trips; `{{var}}` survives in all four positions; header case and
      order are preserved; the six error/warning cases fire.
- [ ] C7 — Apply patches **the current tab** (not a fresh one); the dialog is disabled with its
      tooltip for `formdata`/`file`; the urlencoded→raw conversion is warned before Apply.
- [ ] C8 — `tests/ui/http-raw.spec.ts`'s four tests, each passing twice in a row.
- [ ] C9 — `docs/ARCHITECTURE.md` updated, **including the corrected `(P7)` pointer at `:1016`**.
- [ ] §6.1's full command set green, including the four-chunk check and both bindings checks.
- [ ] §6.5's six real-hardware/real-network steps — run, or recorded as unrunnable here with what
      was read instead, in the same shape P1's own checklist line took.

---

## 8. Open questions, handed forward

**OQ-1 — Genuinely-captured wire bytes are not available, and the shape of a future capture mode.**
D2 declines capture on F2–F6. If it is ever wanted, the contained shape is an **explicitly opt-in,
per-send "HTTP/1.1 debug capture"** toggle that builds a *second*, non-pooled `*http.Transport`
with `ForceAttemptHTTP2: false`, `Proxy: nil`, and a `DialContext`/`DialTLSContext` tee whose sink
is swapped in via `httptrace.GotConn` (F6 confirmed the hook returns our own wrapper). Its cost is
stated so it is a decision rather than a discovery: the request is then sent over a **different
protocol, without the proxy the user's network may require**, so what is captured is the exact
bytes of *a different exchange* than the one the app normally makes. That is defensible as an
explicitly-labelled debug mode and indefensible as a default — which is why this phase renders
instead. Whoever builds it should read F3/F4/F5 first rather than rediscover them.

**OQ-2 — The raw exchange is live-only, not stored with a P8 history entry** (D7). Storing it would
answer *"what exactly did that request send, last Tuesday?"* — which is the natural companion to
P8's own OQ-5 (replay). The blocker is not schema, it is budget: P8 D6's three caps are sized for a
response body, and a rendered exchange adds a second body-sized payload per entry. The contained
shape is a fourth cap, or storing only the **head** (which is small, bounded, and carries most of
the debugging value). P8 OQ-2 asked whether P9 would make binary bodies storable; D5 answers **no**
— the raw pane elides them too — so P8 OQ-2 stays open unchanged.

**OQ-3 — Response header received-order and case remain unavailable**, and now measurably so (F1,
F10). `docs/ARCHITECTURE.md`'s standing note is converted from *"P9 can lift this"* to *"P9
measured that lifting it costs a protocol downgrade"* (C9). Genuinely lifting it requires OQ-1's
capture mode, and it would still be unavailable for h2 and for proxied users.

**OQ-4 — There is no reveal gate on the raw pane** (D6). The values are masked, and the pane points
at *Copy as curl*, which already has the gate. Building a second reveal loop here would be the
third copy of a flow `docs/v1.2/SPEC.md`'s module-boundary section explicitly says should get a
shared home the first time a second consumer is foreseeable — it now has three (a connection reveal
in `project/`, a variable reveal in `http/`, and this). **P12 should treat that as the concrete
trigger for P5 OQ-2's extraction**, not a hypothetical one.

**OQ-5 — Raw editing is modal, not a live fourth request pane** (D8). A persistent pane is what a
"raw-first" workflow (JetBrains' HTTP Client, `.http` files) actually looks like, and it is a real
product direction. It needs three decisions this phase has no mandate for: what the tab's state is
while the buffer is unparseable, which side wins when both change, and whether the builder becomes
read-only in raw mode. Worth revisiting after P13 sees the whole module's UI together.

**OQ-6 — A `formdata` or `file` body cannot be raw-edited** (D10). Editing a multipart body as text
is coherent *if* file parts can name a local path rather than carry bytes — which would need an
extension to the message syntax (something like `< /abs/path` on a part body, the syntax JetBrains'
client uses). That is a small, self-contained design, and it is the natural way to close this gap
without weakening D10's "no guessing" rule.

**OQ-7 — A failed send has no raw view** (D15), even though the request text exists at the moment
of failure. Closing it means returning a partial result through `RunOp`'s `(any, error)` contract.
The contained shape is a typed error payload rather than a partial success — `mapHttpError`
(`bridge/http.go:126-132`) is where it would attach, and P10's timeline wants the same thing for
the same reason (a failed connect has timing worth showing). **The two should be settled together**
rather than each inventing its own partial-result channel.

**OQ-8 — P10 will want `httptrace`, and this phase's decline is not a precedent against it.**
Stated explicitly so it is not misread: P9 declines a custom **dialer** (which changes the
protocol, F3) and declines `httptrace` only as a *byte-capture de-interleaving* mechanism (F6).
`httptrace.ClientTrace` for **timing** — the SPEC's own P10 row names it — installs no dialer,
changes no transport field, and does not affect HTTP/2 negotiation at all. P10 should install it
freely; F3's finding does not apply to it.

**OQ-9 — gRPC (P11) has no HTTP/1.1 text form at all.** A gRPC call is HTTP/2 with length-prefixed
protobuf frames, so the Raw pane as designed has nothing to render for it. P11 should decide early
whether its own "raw" is a frame-level view (message headers, compressed flag, length, a hex/proto
dump) or simply absent — and it should not inherit `RawExchangePane.vue` by default.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/client.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/body.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpvars/resolve.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/response_history.go`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/curl/generate.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/curl/parse.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/state/curl.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/http/ImportCurlDialog.vue`
- `/home/user/kira-studio/packages/shared/domain/http.ts`
