# P10 — Request timeline

> **What this phase is.** `docs/v1.2/SPEC.md`'s P10 row: **the full chronological sequence of what
> actually happened while a request ran — every step, not only the final response's own timing.**
> Where the request involved redirects, **each hop is its own step with its own detail (method, URL,
> status, response headers)**, not folded away into a single number; within each hop, the **phase
> breakdown (DNS resolution, connection, TLS handshake, wait/TTFB, content download)** is shown
> rather than one elapsed-time figure, **with a reused connection shown as reused (no DNS/connect/
> TLS phases to report) rather than as an instant/zero one**.
>
> **What does not land here.** gRPC (P11), the module rename and package split (P12), the
> UI-consistency pass (P13), the module code review (P14). Also explicitly not here: a
> cross-request "why is this endpoint slower than that one" comparison view (D11, OQ-3), a
> timing-based assertion/threshold (OQ-4), byte-level capture of anything (P9 OQ-1, untouched — §3),
> per-hop *request* headers (D9, OQ-6), and a merged Raw+Timeline pane (D11, OQ-2). Nothing here is
> half-built toward any of them (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not
> half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from P2's/P8's/P9's prose.**
> Base: branch `claude/feature-v1-2` at `44883fc` (*"docs(architecture): the raw exchange, what it
> renders and what it cannot capture"*). File:line citations point at that content.
>
> **The SPEC's own "why here" column states a mechanism and a premise, and the premise was
> checked rather than trusted.** It says *"since Go's built-in redirect-following client reuses the
> original request's context across every hop, one trace installed up front fires once per hop
> already"*. That is **true, and it was measured** (F1) — but the same measurements turned up three
> things the premise does not cover and that would each have produced a wrong timeline: `GetConn`
> fires **twice inside one hop** when the transport retries a dead pooled connection (F8),
> `WroteRequest` is **not guaranteed to fire at all** and `GotFirstResponseByte` can **precede** it
> (F9), and for a proxied request `ConnectStart`'s address is the **proxy's**, with the CONNECT
> tunnel's own round trip falling into no phase at all (F12). Thirteen questions were answered by
> **running a traced client against real servers** — a multi-hop redirect chain, a cross-host chain,
> a TLS server, an HTTP/2 server, a hand-written CONNECT proxy, a server that kills pooled
> connections, a server that answers mid-upload, and a real public HTTPS endpoint. Those probes were
> a throwaway module, deleted before commit; each finding records what was run and what came back.
>
> **The one-sentence design.** `httptrace.ClientTrace` is installed once on the send's context and
> its hooks write into a mutex-guarded per-send collector threaded through that same context;
> `checkRedirect` — which already exists, and which fires exactly once between one hop's last trace
> event and the next hop's first (F2) — closes the current hop's bucket and opens the next, so the
> existing `[]RedirectHop` becomes a *projection* of the timeline rather than a second list, and
> nothing about what goes on the wire or how redirects are followed changes at all.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/httpclient/timeline.go` | **new** — `Timeline`, `TimelineHop`, `Phase`, the collector, the trace construction, the per-hop header cap (D2–D9) |
| `apps/kira-studio/internal/httpclient/timeline_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/httpclient/client.go` | the trace + collector installed on `sendCtx`; `checkRedirect` closes/opens a bucket instead of appending to `*[]RedirectHop`; `Redirects`/`FinalURL` derived from the collector; `Response.Timeline` (D2, D3, D16) |
| `apps/kira-studio/internal/bridge/http.go` | `maskWireSecrets` widens to `maskSecrets` — the timeline's hop URLs and hop headers, and `Redirects`/`FinalURL`, join `Wire.Request` (D14/F16) |
| `apps/kira-studio/internal/bridge/ipcerr/ipcerr.go` | one optional `Details json.RawMessage` field (D15, C5 only) |
| `apps/kira-studio/frontend/src/bridge/control.ts` | the error wrapper carries `details` through (D15, C5 only) |
| `packages/shared/domain/http.ts` | `HttpTimeline`, `HttpTimelineHop`, `HttpPhase`; `HttpResponseWire.timeline`; `httpResponsePaneSchema` gains `'timeline'` (D13, F19) |
| `apps/kira-studio/frontend/src/views/httprequest/TimelinePane.vue` | **new** — the waterfall and the per-hop detail (D11, D12) |
| `apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue` | the fifth segment and its branch; the elapsed figure and redirect caption become jump affordances (D11) |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | the failed-send timeline lands in runtime beside `error` (D15, C5 only) |
| `apps/kira-studio/internal/storage/repos/response_history_test.go` | one case: a stored snapshot **keeps** its timeline (D10) |
| `apps/kira-studio/tests/ui/http-timeline.spec.ts` | **new** — §6.4 |
| `docs/ARCHITECTURE.md` | the timeline paragraph, the phase table, the "what falls between phases" note, P9's own OQ-7 pointer resolved |

### 0.2 Out of scope, explicitly

- **P11–P14's own rows**, listed in the header blockquote.
- **Any change to what goes on the wire.** `sharedClient`, its `*http.Transport` and its
  `CheckRedirect` *policy* are byte-identical after this phase. `httptrace` installs no dialer,
  sets no transport field, and — unlike P9's declined capture mechanism (P9 F3) — **does not affect
  HTTP/2 negotiation** (F6, measured). P9 OQ-8 anticipated exactly this and said so; D16 states it
  as a hard invariant with a `git diff` check behind it (§6.6).
- **Byte-level capture.** P9 F2–F6 measured that unavailable at an acceptable cost and OQ-1 recorded
  the shape a future opt-in mode would take. Nothing here revisits it; a timeline needs *timestamps*,
  not bytes, which is precisely why this phase can have what P9 could not.
- **Per-hop request headers.** D9 — the outgoing headers of an intermediate hop are Go's own
  synthesised ones, and P9's Raw pane already answers "what did we send" for the hop that matters.
  OQ-6.
- **A retry, a second request, or any timing-driven behaviour.** The timeline observes; it never
  decides anything. There is no "slow request" threshold, no warning tone keyed on a duration, no
  budget (OQ-4).
- **A new bound method, a new bound service, a new op kind, a new tab kind, a new migration, a new
  table or a new column.** §3 establishes why none is needed: the timeline rides back on the send
  result that already crosses the bridge, and P8's `snapshot_json` already stores that result whole.
- **Sub-connection detail Go does not expose**: TCP retransmits, the TLS certificate chain's own
  verification cost, HTTP/2 stream priority, `Happy Eyeballs`' losing attempt. `httptrace` has no
  hook for any of them (F5's neighbour: what is absent is absent, and the pane says so rather than
  attributing the time somewhere convenient).

### 0.3 Ground rules

- **An absent phase and a zero phase are different facts, and the wire type must not be able to
  confuse them.** This is the SPEC's own explicit requirement (*"a reused connection shown as
  reused … rather than as an instant/zero one"*), and it generalises: a literal-IP URL has no DNS
  phase either (F5), and a plain-`http://` URL has no TLS phase. D4 makes every phase nullable
  rather than defaulted to 0.
- **The timeline must never claim time it did not measure.** The five phases do **not** sum to the
  hop's own duration, and for a proxied request they measurably do not (F12). D5 names the residue
  as a rendered, labelled gap rather than padding a phase to make the bar reach the end.
- **A secret's plaintext must never reach `kira.sqlite` outside `http_variables.secret_value`, and
  must not reach a copyable surface ungated.** P5 D6/F3 drew the first line, P7 D10 and P9 D6 the
  second. F16 found that `Response.Redirects[].URL` and `Response.FinalURL` — P2 fields, persisted
  by P8 since it landed — already cross it in a narrow case, and that a per-hop URL/header list
  would widen it. D14 applies the existing posture to all four rather than inventing a third.
- **`http/**` may not import `views/**`** (`biome.json`, P1 D7); `views/** → http/**` is permitted.
  F18 decides this phase's one placement question from that rule.
- **The timeline must never be the reason a send fails or slows.** Every hook is a few
  `time.Now()` calls under a mutex held for nanoseconds; a hook that finds no open bucket does
  nothing rather than panicking. D2 states the failure posture.

---

## 1. What the code does today

### 1.1 `Send` measures exactly one number, and it is a sum

`httpclient.Send` (`client.go:216-359`) brackets the whole exchange:

```go
start := time.Now()
resp, err := sharedClient.Do(httpReq)
…
limited := io.LimitReader(resp.Body, maxResponseBytes+1)
data, readErr := io.ReadAll(limited)
…
elapsed := time.Since(start)
```

`ElapsedMs: int(elapsed.Milliseconds())` (`:354`) is therefore *"everything from just before `Do`
to just after the body was fully read"* — DNS, connect, TLS, every redirect hop, the wait, and the
download, collapsed into one integer. `ResponsePane.vue:165` renders it as `{{ response.elapsedMs }}
ms`. That single number is the entire timing surface this app has, and it is exactly what the SPEC's
P10 row exists to replace.

Two properties of it worth stating, because D5 has to preserve both:

- It is **milliseconds, truncated** — a 0.4 ms localhost round trip renders as `0 ms` today.
- It **includes the body read**, which the trace has no hook for; `GotFirstResponseByte` is the last
  event the transport reports (F1's dump shows nothing after it), so the download phase's end has to
  be measured by `Send` itself, where `io.ReadAll` returns.

### 1.2 `RedirectHop` captures two fields, and `checkRedirect` threads them through the context

`client.go:78-81`:

```go
type RedirectHop struct {
	Status int    `json:"status"`
	URL    string `json:"url"`
}
```

The doc comment is precise about which URL it is: *"the URL that returned it (not the URL it
redirected to — that is either the next hop's URL, or FinalURL for the last one)"*.

`checkRedirect` (`client.go:106-121`) is the threading, and it is the technique this phase extends:

```go
type redirectsCtxKey struct{}

func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return fmt.Errorf("httpclient: stopped after %d redirects", maxRedirects)
	}
	hops, _ := req.Context().Value(redirectsCtxKey{}).(*[]RedirectHop)
	if hops != nil && req.Response != nil {
		prev := via[len(via)-1]
		*hops = append(*hops, RedirectHop{Status: req.Response.StatusCode, URL: prev.URL.String()})
	}
	return nil
}
```

Its own comment states the two facts this phase depends on:

> *"net/http sets `req.Response` to the redirect response before invoking this (net/http/client.go's
> `do()`), so the status of each hop is available here even though CheckRedirect's own signature
> carries only requests. Each call's own `[]RedirectHop` is threaded through via a context value
> rather than a package-level field, **since `sharedClient` is shared across concurrent Send
> calls**."*

`Send` allocates the slice and installs it (`:227-228`), and reads it back into
`Redirects: *hops` (`:356`). **There is no locking**, and none is needed today: `checkRedirect`
runs only on the caller's own goroutine inside `Do`. F14 is why that changes here.

Note what `checkRedirect` does **not** capture and the SPEC asks for: the hop's **method**, its
**status text**, and its **response headers** — all three are sitting in `req.Response` and
`via[len(via)-1]` at that moment, unread (F13).

### 1.3 Nothing in the repo uses `httptrace`, and P9 measured that installing it is safe

P9 §1.6 verified this by search and it still holds: `git grep -n "httptrace"` over
`apps/kira-studio/internal` returns nothing. `sharedClient`'s transport sets exactly one field,
`Proxy` (`client.go:44-49`).

P9's own OQ-8 was written for this phase and is worth quoting, because it pre-empts the obvious
misreading of P9's findings:

> *"P9 declines a custom **dialer** (which changes the protocol, F3) and declines `httptrace` only
> as a *byte-capture de-interleaving* mechanism (F6). `httptrace.ClientTrace` for **timing** — the
> SPEC's own P10 row names it — installs no dialer, changes no transport field, and does not affect
> HTTP/2 negotiation at all. P10 should install it freely; F3's finding does not apply to it."*

F6 confirms the operative half of that claim by measurement rather than inheriting it.

### 1.4 A response is persisted whole, and one field is deliberately excluded

`bridge/http.go:108-119` hands `resp` to `ResponseHistory.Record`, and
`repos/response_history.go` marshals `httpclient.Response` into `snapshot_json`. P9 F12 stated the
consequence as a standing rule: **any field added to `httpclient.Response` lands in `kira.sqlite` on
every send**, and P9 D7 opted its own field out with one line (`resp.Wire = nil`,
`response_history.go:69-73`) on a size argument.

`Response.Redirects` and `Response.FinalURL` are **not** opted out — they are persisted today, and
have been since P8 landed. F16 is what that turns out to mean.

### 1.5 The response pane has four segments and two dead-end summaries

`ResponsePane.vue:65-72` is `Body · Headers · History · Raw`. Two facts in the status row above it
are rendered and then lead nowhere:

- `data-testid="http-elapsed"` — `{{ response.elapsedMs }} ms` (`:165`).
- `data-testid="http-redirects"` — `redirectCaption`, *"3 redirects → https://…"* (`:113-118`,
  `:201-203`).

Both are precisely the summary this phase supplies the detail behind, and D11 turns them into the
way in rather than adding a fifth thing to notice.

### 1.6 A failed send returns no `Response` at all

`Send` returns `(Response{}, classifySendErr(...))` on a transport failure (`client.go:315-318`,
`:322-325`), `bridge/http.go:93-95` returns that error out of the op closure, and
`RunOp` discards the value. `ResponsePane.vue:153-155` renders `rt.error.message` in a
`MessageStrip` and nothing else.

P9 D15 hit this and declined to solve it, recording OQ-7 with an explicit instruction:

> *"P10's timeline wants the same thing for the same reason (a failed connect has timing worth
> showing). **The two should be settled together** rather than each inventing its own partial-result
> channel."*

F10/F11 measure that a failed send has *real, complete* phase data right up to the failure. D15 is
this phase settling it.

---

## 2. Findings

Every finding marked *"verified by running it"* comes from a throwaway Go module (deleted before
commit) that built `&http.Transport{Proxy: http.ProxyFromEnvironment}` — `sharedClient`'s
configuration, field for field — installed a full `httptrace.ClientTrace` on the request context,
and logged every hook with a monotonic offset alongside a `CheckRedirect` marker.

### F1 — *Verified by running it*: the SPEC's premise holds — one trace fires once per hop
A same-host `301 → 302 → 307 → 200` chain, one trace installed on the original context:

```
 0.065ms  GetConn                127.0.0.1:33181
 0.097ms  ConnectStart           tcp 127.0.0.1:33181
 0.316ms  ConnectDone            tcp 127.0.0.1:33181 err=<nil>
 0.424ms  GotConn                reused=false wasIdle=false
 0.593ms  WroteHeaders
 0.595ms  WroteRequest
 0.821ms  GotFirstResponseByte
 0.865ms  PutIdleConn
 0.884ms  >>> CheckRedirect      via=1 prevURL=…/h0 status=301 X-Hop="0" next=…/h1
 0.893ms  GetConn                127.0.0.1:33181
 0.898ms  GotConn                reused=true wasIdle=true idleFor=31.163µs
 …
 1.458ms  >>> CheckRedirect      via=3 prevURL=…/h2 status=307 next=…/final
 1.460ms  GetConn                127.0.0.1:33181
 1.463ms  GotConn                reused=true wasIdle=true idleFor=10.082µs
 1.467ms  WroteRequest
21.876ms  GotFirstResponseByte
21.966ms  firstBodyRead          n=4096
```

Four hops, four `GetConn`/`GotConn`/`WroteRequest`/`GotFirstResponseByte` sets, from **one**
`httptrace.WithClientTrace` on the initial context. `net/http`'s redirect path builds each
subsequent request with `ctx: ireq.ctx`, so the trace is inherited rather than lost — exactly as the
SPEC's "why here" column reasoned.

### F2 — *Verified by running it, and the decisive structural finding*: `checkRedirect` is exactly the hop boundary
In F1's trace, every `>>> CheckRedirect` sits **after** the preceding hop's `GotFirstResponseByte`
and **before** the next hop's `GetConn`, with no trace event in between. That is not a coincidence
of timing: `net/http/client.go`'s `do()` only builds and issues the next request after
`c.checkRedirect(req, reqs)` returns nil.

So `checkRedirect` is a **free, exact, already-installed** bucket delimiter, and the SPEC's
"the same bucketing technique this phase extends" is right on the mechanism. F8 shows it is also the
*only* correct one.

### F3 — *Verified by running it*: a reused connection reports **no** DNS/connect/TLS hooks at all
Hops 1–3 in F1 fire `GetConn` → `GotConn{Reused:true, WasIdle:true, IdleTime:…}` and then go
straight to `WroteHeaders`. **`DNSStart`, `ConnectStart` and `TLSHandshakeStart` are never called.**

This is the SPEC's own requirement answered by the mechanism rather than by a special case: there is
nothing to report, so a nullable phase is naturally absent, and `GotConnInfo.Reused` — the field the
brief guessed at — is exactly the flag that says why. Confirmed again on a TLS server (F6) and
against a real public endpoint (F7).

### F4 — *Verified by running it*: a cross-host redirect dials fresh, with its own full phase set
Two separate servers, hop 0 on A redirecting to B, addressed via `localhost` so DNS actually runs:

```
 0.125ms GetConn localhost:34923 / DNSStart / DNSDone addrs=[127.0.0.1] / ConnectStart / ConnectDone
 0.659ms GotConn reused=false
 1.140ms >>> CheckRedirect  status=302 next=http://localhost:42989/x
 1.174ms GetConn localhost:42989 / DNSStart / DNSDone / ConnectStart / ConnectDone
 1.404ms GotConn reused=false
```

Both hops carry a complete DNS+connect set of their own. Over TLS/h2 the same shape held with
`tls=7.411ms` on hop 0 and `tls=7.172ms` on hop 1 (§the prototype run, F15). So the per-hop phase
breakdown is genuinely per-hop, not per-send.

### F5 — *Verified by running it*: DNS is absent for a literal-IP host, which is a third kind of "no phase"
Every 127.0.0.1 probe above fires `GetConn` → `ConnectStart` with **no** `DNSStart`: `net.Dial`
short-circuits the resolver for an IP literal. So "no DNS phase" has (at least) two distinct causes —
*the connection was reused* and *there was no name to resolve* — and only the first is explained by
`Reused`. D4/D13 render them as two different sentences rather than one blank.

### F6 — *Verified by running it*: every hook fires under HTTP/2, so the timeline does **not** degrade the way P9's raw view does
An `httptest` server with `EnableHTTP2`, one redirect, `ForceAttemptHTTP2`:

```
 0.194ms TLSHandshakeStart
 2.282ms TLSHandshakeDone   ver=304 alpn="h2" resumed=false
 2.375ms GotConn            reused=false
 2.442ms WroteHeaders / WroteRequest
 2.913ms GotFirstResponseByte
 3.011ms >>> CheckRedirect  status=302
 3.023ms GetConn / GotConn  reused=true
 3.362ms GotFirstResponseByte
         bodyDrained proto=HTTP/2.0
```

**This is the sharpest contrast between this phase and P9.** P9's raw pane must label an h2 exchange
as a reconstruction (`fidelity: 'http2'`, P9 D3/F2) because there are no HTTP/1.1 bytes to show. A
*timeline* has no such problem: DNS, connect, TLS, request-written and first-byte are all real,
measured events regardless of framing, and the second hop's `Reused:true` correctly describes a
multiplexed stream on the same connection. The timeline is fully accurate under HTTP/2, and D13 says
so rather than importing P9's fidelity vocabulary.

One difference worth recording: **`PutIdleConn` does not fire under h2** (a multiplexed connection
is never "put idle"). That rules `PutIdleConn` out as a hop-end marker, which F2 had already settled
for a better reason.

### F7 — *Verified by running it against a real public endpoint*: connection reuse is the timing surprise this feature exists to explain
Two sequential requests to `https://proxy.golang.org/` through the app's exact transport config:

```
request #1   DNS 5.06ms · connect 0.38ms · TLS 15.49ms · wait 28.51ms · download 0.81ms   (50.6ms total)
             alpn="h2"  proto=HTTP/2.0  reused=false
request #2   (no DNS, no connect, no TLS)     wait 8.48ms · download 0.21ms                (8.8ms total)
             proto=HTTP/2.0  reused=true  wasIdle=true idleFor=129.079µs
```

Same URL, same client, **5.7× difference**, and today the app renders `51 ms` then `9 ms` with no
explanation available anywhere in the UI. `sharedClient` is package-level precisely so this reuse
happens (`client.go:40-43`'s own comment), so this is the *normal* case for anyone pressing Send
twice — not an edge one. It is the single best argument for the SPEC's "shown as reused, not as an
instant/zero one" wording.

### F8 — *Verified by running it*: `GetConn` fires **twice inside one hop** when the transport retries a dead pooled connection
The obvious alternative to F2's delimiter is "a new hop starts at `GetConn`". It is wrong. A server
was warmed to populate the idle pool, its connections were then killed server-side, and one further
request was issued — **no redirect anywhere**:

```
 0.010ms GetConn        127.0.0.1:41227
 0.017ms GotConn        reused=true wasIdle=true idleFor=190.707µs
 0.039ms WroteHeaders
 0.041ms WroteRequest
 0.141ms GetConn        127.0.0.1:41227        <-- second acquisition, SAME hop
 0.177ms ConnectStart / 0.240ms ConnectDone
 0.263ms GotConn        reused=false
 0.294ms WroteHeaders / WroteRequest
 0.366ms GotFirstResponseByte
```

Bucketing on `GetConn` would have invented a phantom hop with a status of 0 and no URL, for an
ordinary request against an ordinary server that recycles connections. **`checkRedirect` is the only
delimiter that cannot do this**, because it is called once per redirect *by definition*. D2 chooses
it on this measurement, and D7 decides what to do with the extra attempt (record it as a count, not
as a hop).

### F9 — *Verified by running it*: `WroteRequest` may fire after the first response byte, or never
Two separate cases, both real-world shaped:

1. **A 2 MiB upload with `Expect: 100-continue` against a server sending `103 Early Hints`.**
   `GotFirstResponseByte` fired at **12.448ms** and `WroteRequest` at **13.257ms** — the response
   started before the request finished. A naive `wait = GotFirstResponseByte - WroteRequest` is
   **negative** here.
2. **An 8 MiB upload the server rejects with `413` after reading 1 KiB.** `WroteRequest` **never
   fired at all** (`wroteRequest.IsZero() == true`), because the transport abandoned the body write
   when the response arrived. A naive subtraction reads `GotFirstResponseByte - <zero time>`, i.e. a
   ~57-year "wait".

Both are ordinary HTTP: a server is entitled to answer before you finish talking. D8 is the guard,
and it is a guard against a *measured* case, not a hypothetical one.

Also observed there: `GotFirstResponseByte` fires on the first byte of the **1xx**, not of the final
response, and `Got1xxResponse` fires afterwards with the informational status and its headers
(`code=103 link="</style.css>; rel=preload"`, then `code=100`). D5 notes what TTFB therefore means.

### F10 — *Verified by running it*: a failed send still yields real phase data
```
connect refused:  GetConn / ConnectStart / ConnectDone err="connect: connection refused" (0.254ms)
DNS failure:      GetConn / DNSStart / DNSDone addrs=[] err="lookup … on 8.8.8.8:53: no such host" (3.186ms)
```

Both then surface as a `*url.Error` out of `Do`. So for the two failure modes a user most wants
explained — *"it hung, where?"* and *"it couldn't find the host"* — the phase data exists and is
currently thrown away (§1.6). Under the app's own 30 s deadline (`client.go:29`), a request that
times out mid-TLS-handshake has a *complete* DNS and connect phase and an *open* TLS one, which is
the whole answer. D15.

### F11 — *Verified by running it*: exceeding the redirect limit yields N complete hops and no response
A `/loop → /loop` server with the limit set to 3: three full `CheckRedirect` calls fired, each with
its complete phase set, and then `Do` returned `stopped after 3 redirects`. `client.go:112-114`'s
`maxRedirects = 10` failure therefore also has a full ten-hop timeline behind it — the most
informative possible rendering of a redirect loop, and today it renders as one error line.

### F12 — *Verified by running it*: through a real CONNECT proxy the TLS phase **is** reported, but "connect" means the proxy
A hand-written CONNECT proxy in front of a TLS/h2 origin, with the app's `Proxy` behaviour:

```
 0.039ms GetConn        127.0.0.1:35369       <-- the PROXY's address
 0.080ms ConnectStart   tcp 127.0.0.1:35369   <-- the PROXY's address
 0.230ms ConnectDone
 0.789ms TLSHandshakeStart                    <-- 0.56ms unaccounted: the CONNECT round trip
 2.984ms TLSHandshakeDone  ver=304 alpn="h2"
 3.096ms GotConn        reused=false  remote=127.0.0.1:35369
```

Three facts, each with a design consequence:

- **`TLSHandshakeStart`/`Done` fire**, and correctly measure the end-to-end TLS handshake through the
  tunnel. This is a **direct contrast with P9 F5**, which measured that a conn-level
  `DialTLSContext` hook *never* fires for a proxied https target. The timing hook lives at a
  different layer than the dialer hook, and it survives where the dialer hook does not — so proxied
  users (P9 F5's *"every corporate network"*) get a complete timeline, not a degraded one.
- **`ConnectStart`/`Done` measure the TCP connect to the *proxy*.** That is honest — it is the
  connection actually being made — but it is not a connect to the origin, and the pane must not
  imply otherwise.
- **The CONNECT request/response round trip (0.56 ms here, a WAN round trip in reality) belongs to
  no phase at all.** It sits between `ConnectDone` and `TLSHandshakeStart` and `httptrace` has no
  hook for it. This is the concrete instance of §0.3's rule and the reason D5 renders the residue as
  a labelled gap.

Also: `GetConn`'s `hostPort` argument was the **proxy's** address on the first request and the
**origin's** on the second. It is derived from the transport's internal connect-method key and is
not a stable identifier for what the user is talking to. **D9 therefore never renders it** — the
hop's address comes from the hop URL, and its peer from `GotConnInfo.Conn.RemoteAddr()`.

### F13 — *Verified by running it*: `checkRedirect` already has the method, the status text and the full headers the SPEC asks for
A `POST /a` → `303` → `/b` → `307` → `/c` chain:

```
>>> CheckRedirect  hopMethod=POST hopURL=…/a status=303 nextMethod=GET nextURL=…/b
                   hdrs=[Set-Cookie=a=1 Set-Cookie=b=2 X-Seen-Method=POST Date=… Content-Length=0 Location=…/b]
>>> CheckRedirect  hopMethod=GET  hopURL=…/b status=307 nextMethod=GET nextURL=…/c
final              body="final-method=GET" finalReqMethod=GET finalURL=…/c
```

- **The hop's own method is `via[len(via)-1].Method`**, and it genuinely differs per hop — a 303
  converted `POST` to `GET` while the 307 preserved it. Reading the method off the original request
  would have been wrong for three of the four hops here.
- **`req.Response.Header` carries the complete header set**, duplicates included (two `Set-Cookie`
  rows survived), so `flattenHeaders` (`client.go:190-203`) applies unchanged.
- **The final hop** comes from `resp` itself: `resp.Request.Method`, `resp.Request.URL`,
  `resp.StatusCode`, `resp.Status` — all already read by `Send` today (`:340-355`).

So every field the SPEC's row names is available with no new mechanism whatsoever.

### F14 — Trace hooks and `checkRedirect` run on different goroutines; today's threading has no lock
`client.go:110`'s own comment says `sharedClient` *"is shared across concurrent Send calls"*, and
threading through the context is what keeps each send's hops separate. That reasoning carries over
unchanged. What does **not** carry over is the absence of a mutex: `checkRedirect` runs on the
caller's goroutine, while `httptrace` hooks (`ConnectStart`/`ConnectDone`/`DNSDone`/`GotConn`) are
invoked from the transport's own dial and read goroutines. The collector is written from both, so it
needs a `sync.Mutex` — the existing `*[]RedirectHop` did not, which is exactly the kind of thing a
plan that reasons by analogy would miss. F15 is this verified.

### F15 — *Verified by running it under `-race`*: the exact proposed design works
A working prototype of D2/D3 — a mutex-guarded `timeline` in a context value, trace closures writing
into `tl.cur()`, `checkRedirect` closing the bucket and appending the next — was run with
`go test -race`:

| case | result |
|---|---|
| same-host `301→302→307→200` | **4 hops**; hop 0 `reused=false`; hops 1–3 `reused=true` with **no** DNS/connect/TLS phases recorded |
| cross-host TLS/h2 redirect | **2 hops**, each with its own `dns`+`connect`+`tls` (`0.544/0.212/7.411` and `0.069/0.196/7.172` ms) |
| **8 concurrent sends** of the 3-redirect chain | every one produced exactly 4 hops; **race detector clean** |
| `413` mid-upload | one hop, `wait` unmeasurable (F9), `download=50.359ms` |
| connect refused | one hop, no status, no URL, `connAttempts=1` |

No empty or phantom buckets in any case. The design is proven, not proposed.

### F16 — `Response.Redirects[].URL` and `Response.FinalURL` are **resolved** URLs, and P8 already persists them
`bridge/http.go:80-92` calls `ResolveRequest` and hands `url` (secrets substituted) to
`httpclient.Send`; `checkRedirect` records `prev.URL.String()` from that resolved request, and
`Send` sets `FinalURL` from `resp.Request.URL` (`client.go:340-343`). P8's `Record` then marshals
the whole `Response` into `snapshot_json` (§1.4), and `repos/response_history.go:69-73` nils only
`Wire`.

So **a secret substituted into a query string (`?api_key={{token}}`) is already written to
`kira.sqlite` in plaintext today**, inside `Redirects[].URL` and `FinalURL`. That is a narrow case —
it needs a secret in the URL rather than a header — but it is exactly the failure P5's schema and
P8 F3/D2 were built to prevent, arriving through a field neither phase examined.

This phase does not merely inherit it: a per-hop URL list plus per-hop response headers (a
`Location:` header is a URL too) would widen the same hole across every hop. D14 closes all four
together with the replacer P9 D6 already built, which is why this is a finding rather than an
unrelated bug report.

### F17 — A timeline is ~1 KB, which is why D10 can persist what P9 D7 could not
P9 D7 declined to store its `WireExchange` on a size argument, and P9 OQ-2 named the blocker
precisely: *"The blocker is not schema, it is budget: P8 D6's three caps are sized for a response
body, and a rendered exchange adds a second body-sized payload per entry."*

That argument does not transfer, and the arithmetic says why. A timeline's JSON is: one envelope
(~120 B) plus per hop a method/URL/status/statusText (~150 B), five nullable phase objects (~200 B),
a reuse flag, a remote address and an attempt count (~80 B). A **no-redirect** request — the
overwhelming majority — is therefore **one hop, ≈550 bytes**. A four-hop chain with a typical
redirect's six response headers per intermediate hop is ≈3 KB. The worst case this phase permits is
10 hops × (550 B + D9's 8 KiB header cap) ≈ **86 KB**.

Against P8 D6's per-entry body cap of **256 KiB** (`repos/response_history.go:18`) the typical case
is **0.2%** and the adversarial ceiling is a third of one body — and `stored_bytes` already counts
`len(snapshot_json)`, so the existing 128 MiB table budget absorbs it with no change. Nothing about
P8's three caps needs revisiting.

### F18 — The import rules place the one new component, and no primitive is missing
`biome.json` forbids `http/** → views/**`; `views/** → http/**` is permitted. `TimelinePane.vue` is
mounted from inside `ResponsePane.vue` and needs `theme/primitives/`, so it belongs in
`views/httprequest/` — P9 F16's identical reasoning for `RawExchangePane.vue`.

Every surface it draws already has its primitive: `SegmentedControl` (the fifth option),
`MessageStrip` (the reuse note, the gap note, the failure note), `EmptyState`, `IconButton`,
`formatBytes`/a new local `formatMs`. **The waterfall bars need no primitive and no charting
library** (D1) — they are five nested `<div>`s with percentage widths.

**And no new colour token.** `theme/tokens.css:102-113` already defines a twelve-hue,
light-and-dark-paired palette (`--kira-conn-blue`, `--kira-conn-teal`, `--kira-conn-violet`,
`--kira-conn-amber`, `--kira-conn-green`, `--kira-conn-grey`, …) built for connection colour-coding
and consumed through `theme/connColor.ts`. D12 draws the five phases from it, so the waterfall is
theme-correct by construction and `primitives.css` is untouched.

**One duration-formatting convention already exists and is reused rather than reinvented.**
`RunState.vue:13-19`'s `label`: under 1000 ms it renders `${Math.round(ms)} ms`, at or above it
`${(ms/1000).toFixed(1)} s`. D12's `formatMs` follows it, with one deliberate extension — a figure
below 1 ms renders two decimals (`0.44 ms`) rather than rounding to `0 ms`, since D4's whole point
is that a sub-millisecond reused hop is a real measurement and not an absence.

### F19 — *Verified safe*: widening `httpResponsePaneSchema` a third time cannot break a restored tab
`http.ts` is `z.enum(['body','headers','history','raw'])` with `.default('body')`. P8 F11 established
the reasoning and P9 F13 reused it: every stored value stays a member, and `state/tabKinds.ts`'s
`parseState` merge-normalises the rest. The reverse direction (a tab saved with `'timeline'` opened
by an older build) is not a case this app has — it has never shipped.

### F20 — The success path needs no bridge change; only the failure path does
`Response` already crosses the bridge on every send, so a `Timeline` field arrives in the renderer
for free — no new bound method, no new channel, no `tests/ui/support/{ipcChannels,mockRuntime}.ts`
entry (compare P8, which needed five of each).

The failure path is different. `ipcerr.Error` is `{Code, Message string}` and its `Error()` is that
struct's JSON (`ipcerr.go:12-27`); `control.ts:68-96` reads `err.cause.{code,message}` and falls back
to `JSON.parse(message)`. There is **no channel for structured detail on a failure**, for any bound
method in the app. D15 adds one optional field rather than inventing a side channel — and does it in
its own commit, because it is the one change in this phase that touches every service's error path.

### F21 — An adversarial server can make per-hop headers unbounded
`http.Transport.MaxResponseHeaderBytes` defaults to 10 MB when unset, and `sharedClient`'s transport
leaves it unset. A redirect chain of 10 hops could therefore present ~100 MB of response headers,
all of which D9 would otherwise copy into `Response` and D10 would persist. D9 caps a hop's headers
at 8 KiB with an explicit `headersTruncated` flag — the same "truncate visibly, never silently"
posture P9 D4 and P8 D5 both take.

### F22 — LAW 12 forbids a progress bar, and a waterfall is not one — but the distinction has to be drawn, not assumed
`RunState.vue:4-6` carries the design system's own rule verbatim: *"P16 design system LAW 12:
work-in-progress is a ring and an elapsed time in the toolbar that started it, **never a bar across
the top of the view**"* (`docs/design/kira-design-system/Main.dc.html:178`, `:400`). So the app has
an explicit, standing prohibition on horizontal bars, and this phase draws horizontal bars.

They are different things and the rule's own wording says which: LAW 12 governs **work in progress**
— an indeterminate or advancing indicator for something still running, which competes with the ring
that is the app's answer for that. A waterfall here is a **static chart of a finished exchange**: it
never animates, it never appears while a request is in flight (the pane has no data until `Send`
returns), it is inside a pane the user chose to open rather than across the top of a view, and the
ring plus `RunState`'s elapsed figure remain the *only* running-state indicator, untouched by this
phase.

Recorded as a finding rather than left implicit because a reviewer reading `RunState.vue`'s comment
would otherwise reasonably read D12 as violating a stated law, and because **P13's UI pass is the
phase that owns this call** — if it judges the bars to read as progress, the contained alternative is
a numeric phase table with no bar at all, which loses proportionality but keeps every fact. OQ-9.

---

## 3. Checked, and not fired

- **No `sharedClient` change, no transport-field change, no custom dialer.** `httptrace` needs
  none of them; F6 confirms HTTP/2 negotiation is unaffected. §6.6 makes this a diff check, not an
  intention.
- **No change to redirect *policy*.** `maxRedirects = 10` is unchanged, `checkRedirect`'s
  `len(via) >= maxRedirects` guard is unchanged, and which redirects are followed is unchanged. What
  changes inside `checkRedirect` is only what it *records* (D16).
- **No new bound method, service, op kind, tab kind, migration, table or column** (F20, D10).
- **No `HttpSendArgs` field.** Nothing about the timeline is decided by the renderer — it is not
  opt-in, because the cost is a handful of `time.Now()` calls (D2) and a conditional would be more
  code than the thing it guards.
- **No charting or timeline library.** D1 names the requirement.
- **No `theme/primitives/` addition and no `primitives.css` change** (F18).
- **No `@codemirror/*` or other package addition.** Nothing is installed by this phase.
- **No `NOTICES.md` change** — scoped to bundled icon assets, and this phase adds no asset.
- **No `docs/PERF.md` budget.** The instrumentation is not on a budgeted path (D2's arithmetic), and
  the pane is reached by an explicit click.
- **No change to P8's three caps** (F17), no change to `historyPerScopeLimit`, `maxHistoryBodyBytes`
  or `historyByteBudget`.
- **No `menutemplate.go` change, no accelerator, no palette command.** Unlike P9's *Edit as raw
  HTTP…* (an action), this is a pane — reached by the segmented control and by D11's two jump
  affordances, the same way History and Raw are.
- **No `go-ts-vocabulary-parity.spec.ts` edit.** It reads `internal/httpclient/body.go`'s
  `validBodyModes` and `contentTypeByCodeLanguage` literals; neither is touched.

---

## 4. Decisions

### D1 — The library check, stated rather than asserted
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Two questions here.

- **Collecting per-phase timings: `net/http/httptrace`, adopted.** Stdlib, a dependency by
  definition, named by the SPEC itself, and F1–F13 measured that it answers every question the row
  asks. The alternative — wrapping the transport in a `RoundTripper` and timing `RoundTrip` — yields
  exactly one number per hop and none of the five phases, because DNS, connect and TLS all happen
  *inside* the call it would bracket. There is no third option that does not involve a custom dialer,
  which P9 F3 measured turns HTTP/2 off.
- **Rendering the waterfall: no library, and the requirement is not "it would be small".** The
  candidates for a timing waterfall in a Vue app are general charting packages (`apache-echarts`,
  `chart.js`, `d3`) or Gantt components. **The requirement none of them meets** is that a phase bar
  here has to render **absence** distinctly from **zero** (§0.3, the SPEC's own wording) and has to
  render a **labelled unattributed gap** (D5/F12) — a charting library's stacked-bar primitive takes
  an array of numbers and has no vocabulary for "this segment is not applicable" as distinct from
  "this segment is 0". Every one of them would also arrive with its own colour system, which F18's
  existing `--kira-conn-*` palette makes unnecessary, and its own chunk, against the four
  `docs/ARCHITECTURE.md:28` records. The thing actually being drawn is five `<div>`s with percentage
  widths inside a flex row — and F22 is the separate question of whether it should be drawn as bars
  at all. Declining here is on the requirement, not on line count.

### D2 — One trace, installed once on `sendCtx`, writing into a mutex-guarded collector
`client.go`'s existing context setup (`:225-228`) becomes:

```go
sendCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
defer cancel()
tl := newTimeline()                                       // D3: replaces the bare *[]RedirectHop
sendCtx = context.WithValue(sendCtx, timelineCtxKey{}, tl)
sendCtx = httptrace.WithClientTrace(sendCtx, tl.trace())  // F1: inherited across every hop
```

`tl.trace()` returns a `*httptrace.ClientTrace` whose nine hooks all take the same shape:

```go
func (tl *timeline) with(f func(h *hop)) {
	tl.mu.Lock()
	defer tl.mu.Unlock()
	f(tl.current())   // never nil: current() opens hop 0 on first use
}
```

Three properties, each deliberate:

- **The mutex is required** (F14) — hooks run on the transport's dial and read goroutines,
  `checkRedirect` on the caller's. F15 ran 8 concurrent sends of a 3-redirect chain under `-race`
  clean with exactly this shape.
- **A hook can never fail a send.** There is no error path: every hook records a timestamp or a flag
  and returns. `current()` cannot return nil. Nothing is allocated per event beyond the hop struct
  itself, which is allocated once per hop.
- **The cost is not worth making optional.** Nine closures installed once, plus per hop roughly ten
  `time.Now()` calls and ten mutex acquisitions that contend with nothing. Against a request whose
  cheapest measured hop was 0.4 ms (F1) and whose realistic wait is tens of milliseconds (F7), this
  is unmeasurable — so there is no `HttpSendArgs` flag, no setting, and no branch (§3).

### D3 — The collector **replaces** `redirectsCtxKey`; `Redirects` becomes a projection
This is the one structural change to existing code, and it is what keeps the phase from having two
lists of hops that can disagree.

`redirectsCtxKey`/`*[]RedirectHop` are removed. `checkRedirect` keeps its signature, its guard and
its comment's reasoning, and becomes:

```go
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return fmt.Errorf("httpclient: stopped after %d redirects", maxRedirects)
	}
	tl, _ := req.Context().Value(timelineCtxKey{}).(*timeline)
	if tl == nil || req.Response == nil {
		return nil
	}
	prev := via[len(via)-1]
	// F13: the hop's own method, status text and headers are all readable here and nowhere else.
	tl.closeHop(prev.Method, prev.URL.String(), req.Response)
	return nil
}
```

`closeHop` stamps the bucket's end, fills its detail, and appends the next empty bucket. `Send` then
finishes the final hop from `resp` (F13) after `io.ReadAll` returns, and derives the two existing
fields:

```go
Redirects: tl.redirectHops(),   // every hop but the last, as {Status, URL} — byte-identical output
FinalURL:  finalURL,            // unchanged (client.go:340-343)
```

**Why derive rather than keep both.** Two collectors filled from the same `checkRedirect` call would
be two things to keep in step forever, and the first divergence would be silent — `Redirects` is
rendered in the status row and the timeline in a pane, so nobody would see them disagree. One
collector with a projection cannot drift. `redirectHops()` produces exactly what `*hops` produced
before, so `client_test.go`'s existing `TestSend_RedirectChain` passes **unedited**, which is the
check that the refactor was behaviour-preserving (§6.6).

### D4 — A phase is measured or absent, never zero
```go
// Phase is one measured interval. A nil *Phase means the phase did not happen — a reused
// connection has no DNS/connect/TLS (F3), a literal-IP URL has no DNS (F5), a plain-http URL has
// no TLS. That is a different fact from a phase that took no measurable time, and the SPEC's own
// P10 row requires the two not be confused.
type Phase struct {
	StartOffsetMs float64 `json:"startOffsetMs"` // from the send's t0
	DurationMs    float64 `json:"durationMs"`
}
```

Every phase on a hop is `*Phase` with `json:",omitempty"`, so an absent phase is a **missing key**
in the JSON and `undefined` in TypeScript — not `0`, and not a sentinel a consumer must remember to
check for.

**Units: `float64` milliseconds, rounded to 3 decimal places in Go.** Not `int` milliseconds, which
`ElapsedMs` already is and which renders a real 0.4 ms hop as `0 ms` (§1.1) — the reused-connection
case this feature exists to explain is *exactly* the sub-millisecond one (F1's hops 1 and 2 were
0.44 ms and 0.11 ms). Not microseconds-as-`int64`, which would introduce a second time unit into a
codebase that has one. Rounding in Go rather than the renderer keeps the JSON free of float noise
and makes the stored snapshot stable.

### D5 — The five phases, what each one brackets, and what deliberately falls between them

| phase | from | to | absent when |
|---|---|---|---|
| `dns` | `DNSStart` | `DNSDone` | the connection was reused (F3), or the host is an IP literal (F5) |
| `connect` | `ConnectStart` | `ConnectDone` (`err == nil`) | the connection was reused (F3) |
| `tls` | `TLSHandshakeStart` | `TLSHandshakeDone` | the connection was reused, or the scheme is `http` |
| `wait` | `WroteRequest` | `GotFirstResponseByte` | D8's guard fires (F9) |
| `download` | `GotFirstResponseByte` | the hop's end | never, for a hop that got a response |

**The hop's end** is `checkRedirect`'s own moment for an intermediate hop (net/http drains and
closes the redirect's body just before it, F2) and, for the final hop, the moment `io.ReadAll`
returns in `Send` — the same instant `elapsed` is already computed at (§1.1). So `download` for the
final hop is genuinely "how long the body took", the number `ElapsedMs` has never separated out.

**What falls between phases, and is rendered rather than absorbed.** These five do not sum to the
hop's duration, and pretending they do is the one dishonesty available here:

- `ConnectDone → TLSHandshakeStart` — for a proxied HTTPS request this is the **entire CONNECT
  tunnel round trip** (F12 measured 0.56 ms on loopback; on a real WAN link it is a full RTT).
- `GotConn → WroteRequest` — writing the request, including a large upload body. Not given its own
  phase because `WroteHeaders` and `WroteRequest` bracket it only when the write completes (F9), so
  a named "upload" phase would be absent exactly when a big upload made it interesting.
- `DNSDone → ConnectStart`, `TLSHandshakeDone → GotConn` — connection-pool bookkeeping, normally
  microseconds.

The pane renders the residue as an unlabelled neutral segment in the bar plus a note when it exceeds
5 % of the hop, naming the proxied case explicitly (D13). **`totalMs` per hop and for the send are
measured directly**, never summed from the phases.

**One honest note on `wait`/TTFB**: `GotFirstResponseByte` fires on the first byte of a `1xx`
informational response when there is one (F9), so for a server sending `103 Early Hints` the wait
phase ends earlier than "the response started". This is the same thing every browser devtools panel
reports and it is what the hook means; D13's per-hop detail lists any `1xx` seen so the number is
interpretable rather than surprising.

### D6 — Reuse is `GotConnInfo.Reused`, and the pane says which of two reasons applies
The brief's guess was right and it was verified (F3, F7, F12): `GotConn`'s `httptrace.GotConnInfo`
carries `Reused bool`, `WasIdle bool` and `IdleTime time.Duration`, and on a reused connection
**none of the three connection phases fire at all**. The hop records:

```go
Reused     bool    `json:"reused"`
IdleMs     float64 `json:"idleMs,omitempty"`   // GotConnInfo.IdleTime, when WasIdle
RemoteAddr string  `json:"remoteAddr"`         // GotConnInfo.Conn.RemoteAddr() — F12: NOT GetConn's hostPort
```

`RemoteAddr` is deliberately the peer actually spoken to, which behind a proxy is the proxy (F12).
That is the truthful answer to "who am I talking to", and D13 pairs it with the hop URL so the
distinction is visible rather than hidden.

The pane's sentence for a reused hop is *"Reused an existing connection (idle 0.13 ms) — no DNS
lookup, TCP connect or TLS handshake was needed."* For a fresh connection to an IP-literal host it
is instead *"No DNS lookup — the URL names an IP address."* (F5). Two absences, two causes, two
sentences.

### D7 — A second connection attempt inside one hop is a count, not a phantom hop
F8's measured case: a hop can legitimately fire `GetConn`/`GotConn` twice when the transport
discovers its pooled connection is dead and retries. The bucket stays one hop, and:

- `connAttempts` increments on every `GetConn`;
- the **first** `ConnectStart`/`DNSStart` timestamps win and the **last** `ConnectDone`/`DNSDone`
  closes them, so the `connect` phase spans the whole acquisition including the wasted attempt;
- the **last** `GotConn` wins for `Reused`/`RemoteAddr`, because it describes the connection the
  request actually went out on.

When `connAttempts > 1` the pane says *"2 connection attempts — the first pooled connection was
no longer usable."* This is a real thing that happens to real users against real load balancers, it
currently renders as an unexplained latency spike, and it costs one integer to explain.

### D8 — The `wait` phase is guarded against both of F9's measured cases
```go
// F9: a server may answer before the request is fully written (a 103, or a 413 rejecting an
// upload mid-flight), in which case GotFirstResponseByte precedes WroteRequest -- or WroteRequest
// never fires at all because the transport abandoned the body write. Either way there is no
// meaningful wait interval, and reporting a negative or 57-year one is worse than reporting none.
if !h.wroteRequest.IsZero() && !h.firstByte.Before(h.wroteRequest) {
	h.Wait = phaseBetween(h.wroteRequest, h.firstByte)
}
```

When the guard fires, `wait` is absent (D4) and the pane says *"The server began responding before
the request was fully sent, so there is no wait interval to report."* — which is itself the most
useful possible thing to know about a `413`-mid-upload.

### D9 — What each hop carries, and the one cap
```go
type TimelineHop struct {
	Index         int      `json:"index"`
	Method        string   `json:"method"`        // F13: via[len(via)-1].Method, per hop
	URL           string   `json:"url"`           // the URL that produced THIS hop's response
	Status        int      `json:"status"`        // 0 when the hop never got a response (F10)
	StatusText    string   `json:"statusText"`
	Proto         string   `json:"proto"`
	Headers       []Header `json:"headers,omitempty"`
	HeadersElided bool     `json:"headersElided,omitempty"`
	Reused        bool     `json:"reused"`
	IdleMs        float64  `json:"idleMs,omitempty"`
	RemoteAddr    string   `json:"remoteAddr,omitempty"`
	ConnAttempts  int      `json:"connAttempts"`
	Info1xx       []int    `json:"info1xx,omitempty"`   // D5's note (F9)
	StartOffsetMs float64  `json:"startOffsetMs"`
	TotalMs       float64  `json:"totalMs"`
	Error         string   `json:"error,omitempty"`     // D15: this hop is where the send died
	DNS      *Phase `json:"dns,omitempty"`
	Connect  *Phase `json:"connect,omitempty"`
	TLS      *Phase `json:"tls,omitempty"`
	Wait     *Phase `json:"wait,omitempty"`
	Download *Phase `json:"download,omitempty"`
}
```

Three scope calls inside this struct:

- **`Headers` is populated for intermediate hops only.** The final hop's headers are already
  `Response.Headers` and the pane reads them from there — the same
  do-not-duplicate-across-the-bridge rule P9 D5 applied to the response body, and here it also keeps
  the largest header set out of P8's stored snapshot twice over. `flattenHeaders` (`client.go:190`)
  is reused unchanged, so duplicates survive and the sort order matches the Headers pane.
- **8 KiB per hop, then `headersElided`** (F21). An adversarial or merely eccentric server can send
  megabytes of headers per redirect and `MaxResponseHeaderBytes` defaults to 10 MB; the cap is
  applied by summing rendered `name: value` lengths and truncating the list, with the flag rendered
  as *"Some response headers for this hop are not shown."*
- **No request headers** (§0.2, OQ-6). An intermediate hop's outgoing headers are Go's own
  synthesised set, and P9's Raw pane already answers "what did we send" exactly for the hop where
  the user authored it.

### D10 — The timeline **is** persisted with a P8 history entry, and P9's reason for not persisting does not transfer
`Timeline` sits on `httpclient.Response`, so P9 F12's standing rule applies: it lands in
`snapshot_json` on every send unless something stops it. **Nothing stops it — deliberately.**

`repos/response_history.go`'s existing `resp.Wire = nil` line stays exactly as it is and gains a
neighbouring comment stating why its sibling is treated differently:

- **Size** (F17). P9 D7's argument was that a rendered exchange *"would double a snapshot's size"*.
  A timeline is ≈550 bytes for the common one-hop case and ≈3 KB for a four-hop chain, against P8's
  256 KiB per-entry cap — 0.2 %. The `stored_bytes` accounting already counts it, and the 128 MiB
  table budget already bounds it. There is no new cap, no schema change, no migration.
- **Value.** "Where did the time go?" is a question people ask about the **past**, more than about
  the request they just watched finish. P8's own compare dialog (D12) puts two entries side by side;
  with this field, *"the same request took 90 ms on Tuesday and 4 s today, and the difference is
  entirely in TLS"* becomes answerable. A live-only timeline would answer the weaker half of the
  question.
- **Consistency.** `Response.Redirects` — the *same hops*, minus their timing — is already persisted
  (§1.4). Storing the redirect chain but stripping its timings would be a stranger rule than either
  alternative.

**The user-visible consequence, stated rather than discovered:** selecting a past response in the
History pane and switching to Timeline **shows that response's real timeline**, not P9's *"no raw
view for a stored response"* empty state. The two panes behave differently for a stored entry and
D13 makes sure each says which it is.

**What is not persisted**: a failed send's timeline (D15), because P8 records nothing at all for a
failed send — *"an entry is a response"* (P8 D2) — and this phase does not reopen that.

### D11 — A fifth response-pane segment, and the two dead-end summaries become the way in
`httpResponsePaneSchema` widens to `z.enum(['body','headers','history','raw','timeline'])` (F19), so
the `SegmentedControl` becomes **Body · Headers · History · Raw · Timeline**.

**Why not merged with P9's Raw pane**, given the SPEC pairs them as *"both surface execution detail
about the same request"*. They are adjacent, and they were still separated, on three grounds:

1. **They answer different questions and degrade differently.** Raw answers *"what bytes"* and must
   label itself a reconstruction for HTTP/2 and for proxied requests (P9 D3); Timeline answers
   *"what took how long"* and is **fully accurate for both** (F6, F12). Putting them in one pane
   would force one fidelity strip over content where it is true of half the pane.
2. **They have different lifetimes.** A stored history entry has a timeline (D10) and has no raw
   exchange (P9 D7). A merged pane would be half-empty for every stored entry.
3. **They are different shapes.** Raw is two tall read-only editors that want all the height; a
   waterfall is a short, wide, scannable list. Stacking them means neither gets what it needs.

**But the discoverability problem a fifth segment creates is answered rather than ignored**, and by
the two facts that already exist and currently lead nowhere (§1.5):

- `http-elapsed` — `51 ms` — becomes a button that switches to the Timeline pane, with
  `v-tooltip="'See where the time went'"`.
- `http-redirects` — *"3 redirects → https://…"* — becomes a button that does the same.

That is the whole integration, and it is better than a fifth segment alone: the user who wonders
about a number clicks *that number*. Both keep their existing `data-testid`s so P2's and P8's specs
are unaffected.

**Five segments is at the edge of comfortable, and P13 owns that judgement, not this phase.** The
segmented control is now `Body · Headers · History · Raw · Timeline`; if that reads as crowded once
the module is seen whole, P13's UI pass is the phase with the mandate to regroup (an overflow item,
or a Body/Headers primary pair with the three detail panes behind a divider). Pre-empting it here
would mean designing a grouping against four panes that P13 then redesigns against five. OQ-2.

### D12 — What the pane actually draws
`TimelinePane.vue`, top to bottom:

- **A summary line**: `4 hops · 1.5 s total`, plus *"connection reused"* when hop 0 is reused (the
  F7 case, and the fastest way to explain a suspiciously quick send).
- **One row per hop**, each:
  - a caption — `1  GET  https://api.example.com/v2/orders  →  301 Moved Permanently`, with the
    status chip reusing `statusClass` (`@shared/domain/http`, already imported by `ResponsePane.vue`);
  - a **waterfall bar**: a full-width track in which the hop's own span is offset by
    `startOffsetMs / timeline.totalMs` and filled with five proportional segments plus the
    unattributed residue (D5). Colours come from F18's existing palette — `--kira-conn-violet`
    (DNS), `--kira-conn-blue` (connect), `--kira-conn-teal` (TLS), `--kira-conn-amber` (wait),
    `--kira-conn-green` (download), `--kira-conn-grey` (residue) — so light and dark are both
    already solved and `primitives.css` is untouched;
  - a **phase list**: `DNS 5.06 ms · Connect 0.38 ms · TLS 15.49 ms · Wait 28.51 ms · Download
    0.81 ms`, where an absent phase renders as `DNS —` with its D6/D13 reason on hover rather than
    being silently dropped from the list (the absence is the point);
  - the hop's notes (reuse, attempts, gap, `1xx`, headers elided);
  - a disclosure for the hop's **response headers** (intermediate hops from `hop.headers`, the final
    hop from `response.headers`), rendered with `ResponsePane.vue`'s existing header-row markup.
- **A legend**, once, under the list.

A hop whose total is a rounding sliver of the send still renders a minimum-width bar, so a
sub-millisecond reused hop is visible rather than a hairline — the same reason D4 uses fractional
milliseconds. Durations are formatted by `RunState.vue`'s existing ms/s convention, with F18's one
extension: a figure below 1 ms keeps two decimals rather than rounding to `0 ms`.

**The bars never animate and never render while a request is in flight** — F22 is the reasoning, and
it is a constraint on the implementation, not a note: LAW 12 reserves moving horizontal indicators
for work in progress, and the ring plus `RunState`'s elapsed figure stay the only thing that shows
a send is running.

### D13 — What each sentence says
Collected so the implementation writes prose once and review can check it against the measurements.

| condition | text | source |
|---|---|---|
| hop `reused`, `idleMs` known | Reused an existing connection (idle {n} ms) — no DNS lookup, TCP connect or TLS handshake was needed. | F3, F7 |
| hop not reused, no `dns` phase | No DNS lookup — the URL names an IP address. | F5 |
| `connAttempts > 1` | {n} connection attempts — the first pooled connection was no longer usable. | F8, D7 |
| `wait` absent, hop got a response | The server began responding before the request was fully sent, so there is no wait interval to report. | F9, D8 |
| `info1xx` non-empty | The server sent {codes} before the final response; the wait figure ends at the first of those. | F9 |
| residue > 5 % of the hop | {n} ms of this hop is not attributed to a phase — for a request through an HTTP proxy this is the CONNECT tunnel setup, which Go does not report separately. | F12, D5 |
| `headersElided` | Some response headers for this hop are not shown. | F21, D9 |
| viewing a stored history entry | This timeline was recorded when the response was received. | D10 |
| the send failed (D15) | The request failed during {phase}. The steps below are what completed before it did. | F10, F11 |
| no timeline at all | *(empty state)* This response has no timeline. | D2 |

Deliberately **not** present: any fidelity strip. P9 needed one because its rendering is a
reconstruction for two of three cases; a timeline is measured in all of them (F6, F12), and adding a
strip that always said "accurate" would be noise.

### D14 — Secrets: the existing replacer widens to cover four fields, closing a gap it did not open
F16 found that `Redirects[].URL` and `FinalURL` already carry resolved URLs into `kira.sqlite`, and
that a per-hop URL/header list would widen the same gap. `bridge/http.go`'s `maskWireSecrets`
(`:136-152`) becomes `maskSecrets(resp *httpclient.Response, usedSecrets map[string]string)` and
applies the **same** `strings.NewReplacer` it builds today to:

1. `resp.Wire.Request` — unchanged, P9 D6;
2. `resp.Timeline.Hops[i].URL` — new;
3. `resp.Timeline.Hops[i].Headers[j].Value` — new (a `Location:` header is a URL, and a redirect's
   `Location` is the most likely place for a secret-bearing query string to reappear);
4. `resp.Redirects[i].URL` and `resp.FinalURL` — **new, and a fix**: these are persisted today and
   were not masked.

The properties P9 D6 stated hold unchanged and are worth restating because they are why this is
safe: **over-masking is possible; under-masking is not.** A secret's literal value occurring
elsewhere is masked too, which is the direction a replacer fails in.

**Two things this deliberately does not do.** It does not mask a hop's `Set-Cookie` or any other
**server-issued** credential — those are not user secrets, the replacer has no way to recognise
them, and P8 OQ-6 already accepted the equivalent for a response body containing a token. OQ-5
extends that open question to per-hop headers rather than pretending it is new. And it does not add
a reveal gate: P9 OQ-4 already named the reveal-flow duplication as P12's concrete trigger, and this
phase adds a third consumer to that list rather than a third implementation.

### D15 — A failed send carries the timeline it got as far as, through one additive field
This closes **P9 OQ-7**, which explicitly asked that P9's and P10's partial-result needs be settled
together rather than each inventing a channel.

**Why it is worth the blast radius.** F10 and F11 measured that the failure cases have *complete*
phase data: a refused connect has a finished DNS phase and a failed connect phase; a 30 s timeout
mid-handshake has finished DNS and connect phases and an open TLS one; a redirect loop has ten
complete hops. These are the requests users most want explained, and a timeline feature that goes
blank for exactly them delivers the easy half.

**The mechanism, in full.** `ipcerr.Error` gains one optional field:

```go
type Error struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	// Details is optional structured context for one specific failure, for a renderer that knows
	// how to read it. Every existing producer leaves it nil and every existing consumer ignores
	// it: `omitempty` keeps Error()'s JSON byte-identical for them.
	Details json.RawMessage `json:"details,omitempty"`
}
```

`mapHttpError` (`bridge/http.go:158-164`) marshals the timeline into it. `control.ts`'s wrapper
(`:68-96`) reads `cause.details` (or the parsed `message`'s) onto `out.details`. `state.ts`'s
`send()` error branch stores it in the tab runtime beside `error`, and `TimelinePane.vue` renders it
with D13's failure sentence.

**Contained by construction, and by commit ordering.** `omitempty` means every other bound method's
error bytes are unchanged; every existing consumer reads `.message`/`.code` and is untouched. And
this lands as **C5, its own commit, last of the functional five** — so if review judges the error
envelope not worth widening for this, C5 reverts cleanly and C1–C4 stand as a complete
successful-send timeline. That is the honest way to propose the one cross-cutting change in the
phase; OQ-1 states the fallback.

**Not persisted** — P8 records nothing for a failed send (D10).

### D16 — Purely additive instrumentation: redirect-following behaviour does not change
The brief asks directly whether this needs changes to the redirect-following behaviour itself. **It
does not**, and the distinction is worth being precise about:

- **Unchanged**: `sharedClient`, its `*http.Transport`, `CheckRedirect` as the client's policy hook,
  `maxRedirects = 10`, the `len(via) >= maxRedirects` guard and its error text, which redirects are
  followed, which method each hop uses, what is sent, and `Response.Redirects`'/`FinalURL`'s
  observable values (D3 derives byte-identical output).
- **Changed, internally**: what `checkRedirect` *records* — one collector instead of one slice, plus
  three fields it already had access to and dropped on the floor (F13).

So the phase is instrumentation plus one refactor of a collector, and §6.6 pins that with
`client_test.go`'s existing redirect test passing unedited and a `git diff` showing no change to
`client.go:40-49`.

---

## 5. Implementation order

Seven commits. C1–C2 add capability with nothing mounted; C3–C4 make it visible; C5 is the one
cross-cutting change, deliberately isolated and droppable; C6–C7 are tests and docs. Per `AGENTS.md`,
run the fast checks (`lint`, `typecheck`, `build`) per commit and the expensive suites once at the
end.

### C1 — `feat(shared): the request-timeline domain`
`packages/shared/domain/http.ts`: `HttpPhase`, `HttpTimelineHop`, `HttpTimeline`,
`HttpResponseWire.timeline?`, and `httpResponsePaneSchema` gains `'timeline'` (F19). Pure addition —
nothing produces or consumes either yet.

### C2 — `feat(http): trace each redirect hop's connection phases`
`internal/httpclient/timeline.go`: the `timeline` collector, `trace()`'s nine hooks (D2), `closeHop`
(D3), the phase construction with D8's guard, D7's attempt counting, D9's 8 KiB header cap, and the
`Timeline`/`TimelineHop`/`Phase` wire types (D4).
`internal/httpclient/client.go`: the ctx installation, `checkRedirect`'s rewrite, `redirectsCtxKey`'s
removal, `Redirects` derived via `redirectHops()`, the final hop closed from `resp`, and
`Response.Timeline`.
`internal/httpclient/timeline_test.go` (§6.2). No caller outside the package —
`go test -race ./apps/kira-studio/internal/httpclient/...` is the whole proof, and
`TestSend_RedirectChain` passing **unedited** is the refactor's own check (D3).

### C3 — `feat(http): a Timeline pane over the request just sent`
`views/httprequest/TimelinePane.vue` (D12, D13) and `ResponsePane.vue`'s fifth segment plus its
branch. **The phase's deliverable, complete on its own terms** for a successful send — including,
via D10 and with no further work, a real timeline for a stored history entry.

### C4 — `feat(http): the elapsed figure and the redirect caption open the timeline`
`ResponsePane.vue`: `http-elapsed` and `http-redirects` become buttons that select the Timeline pane
(D11). Small and separate because it is the discoverability decision, reviewable on its own.

### C5 — `feat(bridge): a failed send carries the timeline it got as far as`
`ipcerr/ipcerr.go`'s `Details` field, `bridge/http.go`'s `mapHttpError`, `control.ts`'s wrapper,
`views/httprequest/state.ts`'s error branch, and `TimelinePane.vue`'s failure branch (D15). **The one
cross-cutting commit**, last of the functional five so it reverts without unpicking anything. Closes
P9 OQ-7.

### C6 — `test: the request timeline`
`tests/ui/http-timeline.spec.ts` (§6.4) and `repos/response_history_test.go`'s one case asserting a
stored snapshot **keeps** its timeline (D10) — the mirror image of P9's own assertion that it drops
`wire`, and the test that would catch a future refactor nil-ing the wrong field.

### C7 — `docs(architecture): the request timeline, what it measures and what falls between phases`
`docs/ARCHITECTURE.md`: the `httptrace` mechanism and the `checkRedirect` bucketing; the five-phase
table with F3/F5's two kinds of absence; **the unattributed-residue note with F12's proxy
measurement**; F6's *"the timeline, unlike the raw view, does not degrade under HTTP/2"* recorded
beside the existing P9 fidelity paragraph; D10's persisted-with-history rule beside P9 D7's
stripped-from-history rule, with F17's arithmetic for why they differ; and D14's masking widening
recorded beside P5's own secret-boundary paragraph, **naming that `Redirects[].URL`/`FinalURL` were
previously unmasked**. Also resolve P9 OQ-7's forward pointer.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus
`go build ./... && go vet ./... && go test -race ./apps/kira-studio/internal/...`.
`bun run setup` first in a fresh container.

**`-race` is not optional for this phase's Go tests.** F14 is the reason: the collector is the first
thing in `httpclient` written from more than one goroutine, and a missing lock would pass every
functional assertion and fail intermittently in production.

Two bindings checks, both from `AGENTS.md`'s warnings and both learned from P9 C3's own note that
`apps/kira-studio/frontend/bindings/**` is git-ignored (so there is no tracked baseline to diff —
inspect the regenerated output directly):

1. `httpclient.Response` gains a field and `ipcerr.Error` gains one (C5), both of which appear in the
   generated models. Confirm the regenerated `httpservice.ts` still calls
   `$Call.ByName("…bridge.HttpService.Send", …)` and **not** `$Call.ByID(<n>, …)` — a `-names`-less
   regeneration breaks every `tests/ui` spec at the first bound call of boot and nothing about the
   failure points at bindings.
2. Confirm `Response` gained exactly one new optional `timeline` field of the new `Timeline` type and
   that no other bound method's signature moved.

Also confirm `bun run build` reports the **same four** lazy chunks `docs/ARCHITECTURE.md:28` records
and no fifth — this phase adds no dependency and no `await import()`.

### 6.2 The Go tests — `internal/httpclient/timeline_test.go`
This earns dedicated tests under `AGENTS.md`'s *"cursor/pagination boundary arithmetic"* and
*"concurrency (ordering, backpressure, cancellation, races)"* clauses: the bucketing is
order-dependent across two goroutines and the phase arithmetic has two measured traps (F8, F9).
Seven cases:

1. **Bucketing across a real 3-redirect chain.** Against an `httptest` server, assert **exactly four
   hops**, each with the right `status`, `url` and `method`, and that `Redirects` derived from them
   is identical to what the pre-phase code produced (D3). *The single most valuable test here* — it
   is the whole premise, and F1 is the measurement it pins.
2. **A reused hop reports no phases** (F3): hops 1–3 have `Reused == true` and `DNS`, `Connect` and
   `TLS` all **nil** — asserted as nil, not as zero, because that distinction is the SPEC's own
   requirement (D4).
3. **A cross-host hop reports its own full phase set** (F4): two `httptest` servers, hop 1 not
   reused, with non-nil `DNS`(via `localhost`)/`Connect`.
4. **`WroteRequest` may never fire** (F9/D8): a handler that answers `413` after reading 1 KiB of a
   large body — assert `Wait == nil` and that the hop still has a `Download` phase and a status.
   This is F9's second measured case as a regression test.
5. **Per-hop method and headers** (F13): a `POST` → `303` → `307` chain — hop 0's method is `POST`,
   hop 1's is `GET`, and hop 0's headers include both `Set-Cookie` rows.
6. **The 8 KiB header cap** (F21/D9): a redirect whose response carries 64 KiB of headers yields a
   truncated list with `HeadersElided == true`.
7. **Concurrency**: 16 concurrent `Send`s of the 3-redirect chain, each asserting four hops with the
   right statuses, run under `-race` (F14/F15).

**`internal/storage/repos/response_history_test.go`** gains one case: `Record` given a `Response`
with a populated `Timeline` stores a `snapshot_json` whose decoded response **keeps** it, with
`Wire` still nil (D10). It is the deliberate mirror of P9's own strip assertion, and together the
two pin that the difference between the fields is intended.

**Explicitly not tested**: that `httptrace` fires (stdlib), that a `float64` rounds, that an absent
phase marshals to a missing key (a `json` tag). Each restates a short function body —
`AGENTS.md`'s *"everything else gets nothing"*.

### 6.3 No new unit spec
Nothing in this phase is renderer-side logic with interacting rules. The pane's arithmetic is
`startOffsetMs / totalMs` percentages over data Go already validated; P9 earned
`http-raw-parse.spec.ts` because it shipped a *parser*, and this phase ships none. Adding a spec that
asserts a division would be the *"restates a short function body"* case `AGENTS.md` names.

### 6.4 The UI spec — `tests/ui/http-timeline.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked. Five tests:

1. **The waterfall.** Seed an `httpSend` snapshot whose response carries a four-hop `timeline`; open
   a request tab, send, switch to **Timeline**; assert four hop rows, each hop's caption showing its
   own method/status/URL, and the phase list for hop 0 showing all five figures.
2. **A reused hop is shown as reused, not as zero.** Assert hop 1's DNS/connect/TLS cells render the
   em-dash absent form and **not** `0 ms`, and that the reuse sentence renders. *This is the SPEC's
   own explicit requirement, asserted directly.*
3. **The jump affordances** (D11): click `http-elapsed` and assert the pane switched to Timeline;
   go back to Body and click `http-redirects` and assert the same.
4. **A stored history entry has a timeline** (D10): with a P8 history entry selected, switch to
   Timeline and assert the seeded stored timeline renders — and, in the same test, switch to **Raw**
   and assert P9 D7's empty state still shows, so the deliberate difference between the two panes is
   pinned rather than incidental.
5. **A failed send** (D15/C5): seed an `httpSend` rejection whose error carries `details`; assert the
   failure sentence and the partial hop render, and that the existing `http-send-error` strip still
   shows. *Drops with C5 if C5 does.*

### 6.5 What only a real Mac and a real network can settle
None of these run in this sandbox (no display, a restricted/proxied network, no macOS backend) —
recorded here as unrunnable, with what was measured or reasoned instead, in the shape P9 §6.5 took.

1. **A real corporate proxy.** *Not run* — none reachable here. F12's hand-written CONNECT proxy is
   what the "connect measures the proxy" and "the CONNECT round trip is unattributed" findings were
   verified against. A TLS-inspecting MITM proxy would additionally make the `tls` phase measure a
   handshake with the *proxy's* certificate, which the pane cannot distinguish; worth one look on a
   real corporate network before P13 styles the note.
2. **The residue's real magnitude on a WAN link.** *Partially run*: F12 measured 0.56 ms on
   loopback, which is a lower bound by construction — on a real link it is one full RTT and will
   frequently exceed D13's 5 % threshold, which is exactly when the note should fire. The threshold
   itself is a guess that a real network should confirm.
3. **Happy Eyeballs' losing attempt.** *Not run* — F7's real endpoint returned both an A and an AAAA
   record (`142.251.189.141`, `2607:f8b0:…`) yet fired `ConnectStart` **once**, so the dual-stack
   race did not surface here. Read instead: `net.Dialer` fires `ConnectStart`/`ConnectDone` per
   attempt, so D7's first-start/last-done rule already spans a losing attempt correctly and
   `connAttempts` does not increment (it counts `GetConn`, not dials). Worth confirming once on a
   network where IPv6 is present but broken — the case that makes this visible.
4. **A 10-hop chain against real internet endpoints.** *Not run* — F1/F11 used local servers.
   Nothing in the bucketing is length-dependent (F11 exercised the limit path with three), but a
   real chain crossing several origins is the natural smoke test.
5. **A real secret in a URL, confirming D14's masking end to end.** *Not run* — no macOS Keychain
   here (`KIRA_INSECURE_SECRETS=1`, AGENTS.md). `maskSecrets` is a pure function over
   `usedSecrets` and is unit-testable, and F16's finding was verified by reading the persisted
   path rather than by writing a real secret into a real database.

### 6.6 What must not regress
- **Nothing about what goes on the wire changes.** `git diff` must show **no change** to
  `client.go:40-49` (`sharedClient` and its transport), and a send's `resp.Proto` for a given
  endpoint must be identical before and after. F6 is the measurement behind the claim; this is the
  check behind the invariant (D16, §0.2).
- **`client_test.go` passes unedited**, `TestSend_RedirectChain` in particular — it asserts
  `Redirects`' statuses and URLs and `FinalURL`, which is precisely the projection D3 rebuilds. A
  needed edit there is a signal the refactor changed behaviour.
- **Studio renders identically.** Nothing here touches `project/**`, `views/grid/**`,
  `views/console/**`, an adapter, or the data plane.
- **`tests/ui/http-request.spec.ts`, `http-request-body.spec.ts`, `http-curl.spec.ts`,
  `http-variables.spec.ts`, `http-dynamic-values.spec.ts`, `http-history.spec.ts`,
  `http-raw.spec.ts`, `collections.spec.ts` and `mode-switch.spec.ts` all pass unedited.**
  `timeline` is optional, so every existing seeded response stays valid with no fixture edit;
  `http-elapsed` and `http-redirects` keep their test ids through D11's change.
- **`op_log` behaviour is byte-identical.** `op.SetCommand` still receives the unresolved URL, both
  times, and no new op kind exists.
- **`kira.sqlite` gains no column and no table**, and P8's three caps are unchanged (F17). A
  `snapshot_json` written after this phase differs from one written before it by exactly one added
  `timeline` key.
- **Every bound method other than `HttpService.Send` produces byte-identical error JSON** after C5 —
  `omitempty` is what guarantees it, and it is worth one explicit check of a non-HTTP error's shape.
- **`bun run test:ipc:fe` passes unedited.** No data-plane frame, adapter or fixture change.
- **No file under `http/**` imports `views/**`**; `bun run lint` is the check (F18).
- **`docs/PERF.md`, `NOTICES.md` and `theme/primitives.css` are unchanged** — §3, F18.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — the three TS additions; `httpResponsePaneSchema` widened with an existing stored value
      still restoring (F19's reasoning, not given its own test, matching P8's and P9's precedent for
      the identical widening).
- [ ] C2 — four hops for a 3-redirect chain with the right per-hop method/status/URL
      (`TestTimeline_BucketsPerHop`); a reused hop's `DNS`/`Connect`/`TLS` are **nil**, asserted as
      nil (`TestTimeline_ReusedHopHasNoPhases`); `TestSend_RedirectChain` passes **unedited** (D3);
      16 concurrent sends clean under `-race`.
- [ ] C2 — D8's guard verified against a real `413`-mid-upload server, not a synthetic timestamp
      (`TestTimeline_NoWaitWhenServerAnswersEarly`).
- [ ] C3 — the fifth segment renders; the waterfall's segments are proportional; an absent phase
      renders as `—` with its reason and never as `0 ms`; the reuse/attempts/gap notes each fire.
- [ ] C4 — clicking the elapsed figure and the redirect caption both select the Timeline pane, and
      both keep their existing `data-testid`s.
- [ ] C5 — a refused connect surfaces its DNS and connect phases in the pane; every other bound
      method's error JSON is byte-identical (`omitempty` verified against one non-HTTP error).
- [ ] C6 — `tests/ui/http-timeline.spec.ts`'s five tests, each passing twice in a row; a stored
      history snapshot keeps its `timeline` and still drops its `wire`
      (`TestResponseHistoryRecordKeepsTimeline`).
- [ ] C7 — `docs/ARCHITECTURE.md` updated, including F12's residue note, F6's h2 contrast with P9's
      fidelity paragraph, F17's arithmetic for why P10 persists where P9 stripped, and D14's note
      that `Redirects[].URL`/`FinalURL` were previously unmasked. P9 OQ-7's forward pointer resolved.
- [ ] §6.1's full command set green, including `-race`, the four-chunk check and both bindings
      checks.
- [ ] §6.6's regression list, `git diff` on `client.go:40-49` in particular.
- [ ] §6.5's five real-hardware/real-network steps — none runs in this sandbox; each recorded with
      what was measured or reasoned instead.

---

## 8. Open questions, handed forward

**OQ-1 — Widening `ipcerr.Error` is the one cross-cutting change here, and it is a scope call worth
a second opinion** (D15). The case for it: F10/F11 measured that the failure cases have complete
phase data, and they are the requests users most want explained — a timeline that goes blank for a
30 s timeout delivers the easy half of the feature. The case against: it touches the error envelope
every bound method in the app returns, for one feature. `omitempty` makes it byte-identical for
every existing producer and consumer, and C5 is sequenced last so it reverts cleanly — but the
decision to widen a universal contract for one caller is a judgement, not a measurement. **If it is
declined, C1–C4 stand as a complete successful-send timeline** and the failure case gets D13's
"no timeline" empty state, with this question left open rather than half-built.

**OQ-2 — Five response-pane segments, and whether P13 should regroup them** (D11). `Body · Headers ·
History · Raw · Timeline` is at the edge of what a segmented control carries comfortably, and this
phase deliberately did not pre-empt the grouping decision — designing one against four panes that
P13 then redesigns against five would be the more expensive order. The contained shapes if P13 wants
them: a primary `Body · Headers` pair with the three detail panes behind a divider or an overflow
item; or promoting Raw and Timeline into a shared "Inspect" segment with an inner toggle (which D11
declined *as a merge* on three grounds, but which is a different proposition as a *grouping*).

**OQ-3 — There is no cross-request timing comparison.** D10 makes per-entry timelines *storable* and
P8's compare dialog already puts two entries side by side, so *"this request got 4× slower and it is
all TLS"* is now answerable in principle — but this phase adds no timing rows to that dialog
(P8 D12's three levels are status, headers and body). Adding a fourth level is small and
self-contained, and it is the natural first thing to build on top of this phase. It is left out
because P8's dialog is P8's design and widening it is not this row's deliverable.

**OQ-4 — Nothing acts on a timing.** No threshold, no slow-request warning tone, no budget. That is
deliberate (§0.2) — the honest version needs a per-endpoint baseline, which needs the history this
phase only just made queryable. Worth revisiting after OQ-3, not before.

**OQ-5 — A redirect hop's `Set-Cookie` (and any other server-issued credential) is now persisted in
plaintext**, alongside the response body that P8 OQ-6 already accepted as persisted. D14's replacer
masks *user* secrets and has no way to recognise a server-issued one. This is the same class of
exposure P8 OQ-6 records and it stays open with that one, now naming a second field it reaches.
Whoever closes P8 OQ-6 should close both.

**OQ-6 — No per-hop request headers** (D9). An intermediate hop's outgoing headers are Go's own
synthesised set and P9's Raw pane answers the "what did we send" question for the hop the user
authored. If it ever matters, `httptrace`'s `WroteHeaderField` hook is the mechanism, it fires per
header per hop, and it is the one hook this phase installed nothing for.

**OQ-7 — Sub-connection detail is unavailable and will stay so under any design that does not fork
the transport.** TCP retransmits, certificate-chain verification cost, HTTP/2 stream priority and
Happy Eyeballs' losing attempt have no `httptrace` hook. P9 OQ-1's opt-in capture transport would
reach some of them, at the protocol-downgrade cost P9 F3 measured. Recorded so a future
*"why is TLS 300 ms?"* question is not mistaken for something this phase left undone.

**OQ-9 — Whether a waterfall bar belongs in an app with LAW 12 is P13's call, not this phase's**
(F22). The law forbids a horizontal bar for *work in progress*; D12 draws a static chart of a
finished exchange, never animated and never present while a send runs, which is a different object.
That reading is argued in F22 rather than assumed, but it is still a reading. **The contained
alternative if P13 disagrees** is a numeric phase table with no bar: every fact survives (the five
figures, the absences, the notes) and only proportionality-at-a-glance is lost — a one-component
change to `TimelinePane.vue` touching nothing else, since the Go side, the wire shape and the
persisted snapshot are all bar-agnostic.

**OQ-8 — gRPC (P11) inherits the mechanism but not the pane.** A gRPC call is HTTP/2, so `httptrace`
fires the same hooks and F6 says they are accurate — the phase collection is directly reusable. What
is **not** reusable is the hop model: a streaming call has one connection and many messages over
time, which is a different shape from a redirect chain and wants a message timeline rather than a
hop waterfall. P11 should reuse `timeline.go`'s collector and design its own view, and it should not
inherit `TimelinePane.vue` by default — the same warning P9 OQ-9 gave about `RawExchangePane.vue`.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/client.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/client_test.go`
- `/home/user/kira-studio/apps/kira-studio/internal/httpclient/wire.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/ipcerr/ipcerr.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/response_history.go`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/bridge/control.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/RawExchangePane.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/state.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/theme/tokens.css`
- `/home/user/kira-studio/packages/shared/domain/http.ts`
