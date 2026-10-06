# P168 Part 7 findings: Studio API client backend

Plan: `P168-part7-api-backend.md`. Base `3410c8e`; HEAD reviewed `86a75d0` (`p168-stream-a`).
Reviewer reports only; no source edited. Probes ran as throwaway `zz_probe_test.go` files, deleted
before each commit.

Edit-scope tags per plan §8. `needs-other-part-file` items are also listed in
`P168-routed-from-streamA.md`.

## Checks

- `go build ./apps/kira-studio/...`: pass.
- `go vet` over `httpclient`, `grpcclient`, `apivars`, `postman`: pass.
- `go test -race` over `httpclient`, `grpcclient`, `apivars`, `postman`, `bridge`, `storage/repos`: pass.
- (TS checks recorded in block 7)

## Findings

### Block 1: HTTP client

#### F1 (medium) transport error text quotes the resolved URL with `%q`; secret masking misses it

- `apps/kira-studio/internal/httpclient/client.go:176` (`newError(CodeHTTPTransport, err.Error(), err)`),
  `:152` (`"invalid URL: "+err.Error()`), `:299`/`:305` (`finishFailed(..., err.Error())`);
  masker `apps/kira-studio/internal/bridge/http.go:373-393` (`maskSendErrTimeline`), `:255-290`
  (`secretReplacer`).
- Scenario: URL `https://api.x/v1?key={{apiKey}}`, secret `apiKey` = `p"w\d`. Host refuses or
  times out at TLS. `*url.Error.Error()` renders `Get "https://api.x/v1?key=p\"w\\d": dial tcp ...`
  (`%q`). `secretReplacer` registers `p"w\d`, its `QueryEscape` and `PathEscape` forms only; none
  matches `p\"w\\d`. Plaintext secret (escaped) reaches `herr.Message`, `Timeline.Hops[i].Error`,
  `ipcerr` message to the renderer, and `RunOp`'s `err.Error()` (`adapterhost/host.go:255`) into
  the op-end event and `op_log.error`. Same for `url.Parse` errors (`"invalid URL: parse %q: ..."`)
  when the secret has a control char or `"`/`\`. Probe: `Send` to `http://127.0.0.1:1/p?k=a"b\c`
  returned `Get "http://127.0.0.1:1/p?k=a\"b\\c": ... connection refused`.
- Fix: in `secretReplacer`, also register `strconv.Quote(rendered)` with its outer quotes trimmed
  (and the same for each escaped form) when it differs from the raw form. Alternative: in
  `classifySendErr` unwrap `*url.Error` and build the message from `ue.Op` + `ue.Err` only (the
  URL is already in the timeline, which is masked), and make `resolveURL` not echo the input
  (`"invalid URL: " + parseErr.Err.Error()`). The second is safer: no encoding variant to chase.

#### F2 (low) redirect to the same host on another port keeps every user header

- `apps/kira-studio/internal/httpclient/client.go:101-107` (`sameRedirectHost` compares
  `Hostname()` only), used by `options.go:184-202`.
- Scenario: request to `https://api.x/` with `Authorization` and `X-Api-Key`; server answers
  `302 Location: http://api.x:8080/` (or `https://api.x:8443/`). Hostnames match, so neither the
  cross-host strip nor (for the https-to-https case) the downgrade strip fires; both headers reach
  the other port's service. Same leak class as curl CVE-2022-27776. Probe: two `httptest`
  servers on `127.0.0.1`, different ports; destination received `X-Api-Key: secret` and
  `Authorization: Bearer s`.
- Fix: compare ports too (`from.Port()` vs `dest.Port()`, defaulting by scheme) in
  `sameRedirectHost` and treat a port change as cross-origin. Add a case to the redirect test.

#### F3 (low) `DeleteJarCookie` misses parent-domain cookies for IDN and trailing-dot hosts

- `apps/kira-studio/internal/httpclient/cookies.go:110`, `:121-139` (`cookieDomainCandidates`).
- Scenario: cookiejar canonicalises the URL host (strips a trailing dot, IDNA to ASCII) and
  rejects a non-ASCII or trailing-dot `Domain` attribute (`errMalformedDomain`), so candidates
  computed from raw `u.Hostname()` fail:
  - `https://a.bücher.example/x`, cookie `Domain=xn--bcher-kva.example`: candidates
    `["", "bücher.example"]`; the second is rejected; cookie survives Remove.
  - `https://a.example.com./x`, cookie `Domain=example.com`: `EffectiveTLDPlusOne` errors on the
    trailing dot, candidates `[""]`; cookie survives.
  - Probe confirmed both (`JarCookies` lists `sid` before and after delete). Uppercase ASCII hosts
    work (domain lowercased by cookiejar). IP, `localhost`, public-suffix hosts behave correctly.
- Fix: canonicalise before computing candidates: trim one trailing `.`, `strings.ToLower`, then
  `idna.Lookup.ToASCII` (`golang.org/x/net/idna`, already in the module graph via `x/net`). Add
  both cases to `cookies_test.go`.

#### F4 (low) Cookies tab and Remove are no-ops for a scheme-less URL that Send accepts

- `apps/kira-studio/internal/httpclient/cookies.go:84-95` (`JarCookies`), `:104-116`
  (`DeleteJarCookie`); caller passes the TS-resolved tab URL
  (`frontend/src/views/httprequest/HttpRequestView.vue:409-415`, read only).
- Scenario: tab URL `api.example.com/login` (no scheme). `Send` defaults it to `https://`
  (`resolveURL`, `client.go:147-149`) and the jar stores the session cookie. `JarCookies` parses
  the raw string: scheme `""`, host `""`, so `cookiejar.Cookies` returns nothing and
  `SetCookies` returns early. Cookies tab shows empty; Remove reports success and deletes nothing.
  Probe confirmed (`before=[] after=[]` with a cookie present for `https://a.example.com`).
- Fix: route both through the same scheme default as `Send` (`if !HasScheme(s) { s = "https://" + s }`
  plus the http/https and host checks), returning `E_BAD_REQUEST` for a non-http(s) URL. Go only.

#### F5 (low) form-data file part: stat uses the trimmed path, stream opens the untrimmed one

- `apps/kira-studio/internal/httpclient/body.go:211-222` (`prepareFormParts` stats
  `strings.TrimSpace(f.Path)`) vs `:313` (`streamFormData` opens `p.field.Path`); `:234` and
  `wire.go:146` take `filepath.Base` of the untrimmed path.
- Scenario: form-data file row path `/tmp/a.txt ` (trailing space or newline, e.g. pasted).
  Validation passes, Content-Length is computed, then the stream goroutine fails `open ...: no such
  file or directory` mid-send, surfaced as `E_HTTP_TRANSPORT`. The `file` body mode trims
  consistently and succeeds with the same path. Probe confirmed both outcomes.
- Fix: store the trimmed path in `formPart` (e.g. `field.Path = trimmed` before appending) so
  stream, header filename and wire marker all use it.

#### F6 (low) cached transports have no handshake or idle timeouts

- `apps/kira-studio/internal/httpclient/options.go:128` (`&http.Transport{Proxy: http.ProxyFromEnvironment}`).
- Scenario: the shipped default `RequestTimeoutMs` is 0 (none, `model.DefaultSettings`). A
  server that accepts TCP but stalls the TLS handshake hangs the send until the user presses Stop
  (`DefaultTransport` would fail after `TLSHandshakeTimeout` 10 s). `IdleConnTimeout` 0 keeps
  idle connections to every host ever contacted open for the process lifetime, across up to four
  transports (`MaxIdleConns` 0 = no total cap).
- Fix: build from `http.DefaultTransport.(*http.Transport).Clone()` (keeps proxy, dialer
  timeouts, `TLSHandshakeTimeout`, `IdleConnTimeout` 90 s, `ExpectContinueTimeout`), then set
  `Protocols` and `TLSClientConfig` as today.

#### F7 (low) final-hop headers and received cookies are unbounded and survive history elision

- `apps/kira-studio/internal/httpclient/client.go:333` (`flattenHeaders(resp.Header)` for the
  final hop, uncapped), `timeline.go:240`/`:252` (`receivedCookies` uncapped by design);
  `options.go:128` leaves `MaxResponseHeaderBytes` at the 10 MiB default;
  `storage/repos/response_history.go:104-116` (elide drops request fields only).
- Scenario: hostile endpoint, `maxRedirects` 10 (default): each hop returns ~10 MiB of
  `Set-Cookie`. `ReceivedCookies` holds ~100 MiB, marshalled over Wails, then into the history
  snapshot. The snapshot exceeds `historyByteBudget/2`; `elide` drops only request fields, so the
  row stays over 64 MiB and, with any other rows, the global sweep (`history.go:186-197`) deletes
  every older row; a row alone over 128 MiB deletes itself too. One response wipes the user's
  whole response history.
- Fix: set `MaxResponseHeaderBytes` (e.g. 1 MiB) on the transports; cap `receivedCookies` by
  count/bytes with a visible `cookiesElided` flag (or cap per hop like `capHopHeaders`); in the
  `response_history.go` elide closure also drop `Response.Headers`, `ReceivedCookies`,
  `SentCookies` and `Timeline.Hops[].Headers` when still oversized. Stream A one-hop files only.

#### F8 (low) `normalize` default timeout contradicts the coupling comment and model default

- `apps/kira-studio/internal/httpclient/options.go:58-64` (`timeout: 30 * time.Second`, comment
  "must equal model.DefaultSettings().Api field for field") vs
  `storage/model/settings.go:88` (`RequestTimeoutMs: 0`, P90 §2.1 "timeout 30s -> none").
- Scenario: no bridge impact (bridge always passes a full `Options`), but any direct caller or
  test relying on the documented equality gets a 30 s timeout where settings say none; the comment
  states a false invariant.
- Fix: set the default to `0` (none) to match the model, or correct the comment to name the
  divergence. No test pins it; `go-ts-vocabulary-parity` could add the pair.

Block 1 candidates (plan §9):
- 1 (negative `RequestTimeoutMs`/`MaxResponseMb` disables caps): dropped. `SettingsRepo`
  rejects out-of-range values (`model/settings.go:175-224`); the tab schema
  `httpRequestSettingsSchema` is `min(0)` and a failed parse drops the row, so only a hand-crafted
  IPC call reaches `normalize` with a negative, and the renderer is first-party.
- 2 (memory peak at 2 GiB cap): dropped. 0 and 2048 are explicit user choices bounded by
  settings validation; history stores at most 256 KiB. Peak (~3-4x body) is inherent to the
  string-over-Wails design, not a defect.
- 3 (cookie delete candidates): confirmed in part, F3. Uppercase is not a bug.
- 5 (errors before `Send` builds `*Error`): every pre-send failure is `*httpclient.Error` and
  `maskSendErrTimeline` masks its `Message`; the residual leak is the quoting gap, F1. Header
  validation errors from `net/http` quote the header name only, never the value.
- 6 (`slog.Warn` in `buildWireExchange`): dropped. `DumpRequestOut` calls `Transport.RoundTrip`
  directly (no `url.Error` wrap); its errors name a header key at most. `renderRequestBody`
  errors are fixed strings; `DumpResponse(resp,false)` does not fail in practice.
- 12 (redirect port change): confirmed, F2. Case-only host differences compare equal (lowercased);
  trailing-dot, IP-vs-name and IDN differences strip (safe direction).

Routed cookie-delete verification (plan §7): reviewed. Path candidates correct for empty, root,
trailing slash, deep paths; expiry matches entries by `domain;path;name` id, so `Secure`
cookies and host-only versus `Domain=host` entries are removed; a never-held name is a no-op;
a non-http(s) URL is a silent no-op (F4). UI copy ("Remove") promises no more than name-scoped
delete. Gaps: F3, F4. Exact-cookie half stays parked. No Part 7 path depends on the old
`getRequestBody` error text (`git grep getRequestBody` hits `repos/collections.go` only).

## Coverage

- Block 1 (HTTP client): done. Reviewed `httpclient/{client,options,body,cookies,timeline,wire,errors}.go`,
  `cookies_test.go`, `bridge/http.go` (Send, resolveSendOptions, secretReplacer, maskSecrets,
  maskSendErrTimeline, mapHttpError, cookie methods), `repos/response_history.go` Record,
  `repos/history.go` Record.
- Block 2: not reached.
- Block 3: not reached.
- Block 4: not reached.
- Block 5: not reached.
- Block 6: not reached.
- Block 7: not reached.
