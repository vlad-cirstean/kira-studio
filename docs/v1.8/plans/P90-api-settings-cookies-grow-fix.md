# P90 — Api request settings, a Cookies tab, and the multi-line grow field

`docs/v1.8/SPEC.md`'s P90 row (`:164`), turned into concrete steps. Everything below was read in the
current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `0033a4fa`, P71-P89 landed); every line
number is from that tree.

Three items. Item 1 (seven settings) lands first; item 2 (Cookies tab) reads the jar item 1 builds,
so it cannot precede it. Item 3 is unrelated to both and can land anywhere in the phase.

One new direct Go dependency (`golang.org/x/net/publicsuffix`, already in `go.sum` as indirect).
No new frontend dependency. No SQLite migration.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How is a per-request "inherit" represented? | Per-leaf `null` in tab state (`z.<T>().nullable().default(null)`, `binaryFile`/`itemId`'s own shape), per-leaf `nil` pointer on the wire (`model.*Patch`'s own shape). No sentinel string, no separate `inherited: boolean` | §2.2 |
| Where does the override resolve? | Go, in `bridge/http.go`, against the persisted globals. The rule is literally `override ?? global` per leaf, so the Settings tab re-states it for display with no shared resolver to drift | §2.5 |
| Where does the per-request UI go? | Two new segments on the request editor's existing `SegmentedControl` — `Settings` and `Cookies` — plus one new segment on the response `SegmentedControl`. Widening those two enums is the move P8/P9/P10 already made three times and verified safe | §2.6, §3 |
| Timeout unit | Milliseconds, `0` = none. Postman's own unit, and the value is already `elapsedMs`-shaped everywhere in this module | §2.1 |
| Max response size unit | Whole MB (`maxResponseMb`), `0` = unlimited — `cache.l2BudgetMb`'s own precedent. Default 50 | §2.1 |
| HTTP version vocabulary | `'1.1' \| '2'`. Go's HTTP/1 *is* 1.1; `'1'` would name a protocol this client never speaks | §2.1 |
| How is HTTP/1 forced? | `http.Transport.Protocols` (`*http.Protocols`, Go 1.24+; this repo is `go 1.27.1`) — `SetHTTP1(true)` alone for 1.1, `SetHTTP1(true)+SetHTTP2(true)` for 2. Not `TLSNextProto: map{}`, the pre-1.24 hack, and not `ForceAttemptHTTP2`, which `Protocols` overrides | §2.3 |
| How is max response size enforced? | The `io.LimitReader(body, max+1)` already at `client.go:391`, with `max` from Options instead of a const. `0` skips the limit reader entirely. `BodyTruncated` keeps its exact current meaning | §2.3 |
| Cookie jar scope | One app-wide, in-memory `*cookiejar.Jar` for the process's lifetime, keyed by host as the stdlib does. Not persisted to SQLite, not per-tab, not per-environment (staging and prod are different hosts, so host keying already separates them) | §2.4 |
| Cookie jar vs. incognito | A jar-enabled send from an incognito tab gets a throwaway per-send jar: cookies still work across that send's own redirect chain, nothing reaches the shared jar. P71's rule is "nothing from this tab is saved" | §2.4 |
| Does `disableCookieJar: true` change today's behaviour? | **No.** `sharedClient.Jar` is nil today (`client.go:44`), so the default-on "disable" is exactly current behaviour, including "no cookies carried across a redirect hop" | §2.4 |
| Item 3: fix or replace the grow mechanism? | **Fix.** All three symptoms come from the replica, the textarea and the highlight overlay disagreeing about their own box metrics — not from the grid-replica trick, which is sound for multi-line content. Replacing it with JS autosize fixes none of the duplication | §4.4 |

Genuinely left out, named rather than half-built (`CLAUDE.md`'s "scope left out stays out"):

- **Persisting the cookie jar across restarts.** Not asked for. The jar dies with the process.
- **Hand-editing a cookie** in the Cookies tab (Postman's cookie manager). The tab lists, deletes
  one, and clears all; a hand-authored cookie is what a `Cookie:` request header already is.
- **gRPC.** `views/grpcrequest/**` gets none of items 1-2. It does get item 3's fix, because
  `MetadataTable.vue` uses the same primitive.

---

# Item 1 — seven settings, global and per-request

## 1. What exists today

`internal/httpclient` is the whole outbound path and is deliberately dependency-free (`client.go:1`-
`:5`): no adapters, no storage, no Wails. Five of the seven settings are hard-coded constants in it:

| Setting | Today | Where |
|---|---|---|
| HTTP version | HTTP/2 whenever ALPN offers it — `sharedClient`'s transport sets only `Proxy`, so `onceSetNextProtoDefaults` enables h2 | `client.go:45`-`:50` |
| Request timeout | 30 s, via `context.WithTimeout` on the caller's ctx, never `http.Client.Timeout` | `client.go:30`, `:269` |
| Max response size | 10 MiB const, truncate-not-refuse | `client.go:39`, `:391`-`:400` |
| SSL verification | Always on, `TLSClientConfig` left nil, explicitly "no per-request opt-out (§8 OQ-4)" | `client.go:42`-`:44` |
| Follow redirects | Always, via `CheckRedirect: checkRedirect` | `client.go:49`, `:119` |
| Max redirects | 10 const | `client.go:35`, `:120` |
| Cookie jar | None — `Jar` nil | `client.go:44` |

`Send(ctx, req)` (`client.go:260`) has three call sites: `bridge/http.go:95`, and two tests
(`bridge/http_test.go:414`/`:471`, `apivars/resolve_test.go:202`).

Global settings are a per-leaf key/value SQLite table. One leaf end to end, as the template:

1. `packages/shared/domain/settings.ts` — a zod section schema, a `.partial()` patch, an entry in
   `settingsSchema`/`settingsPatchSchema`/`defaultSettings`. Every leaf carries `.default(...)` so
   an older stored row still parses (`:134`-`:136`).
2. `internal/storage/model/settings.go` — the Go mirror: a section struct, a `*T`-per-leaf patch
   struct, an entry in `Settings`/`SettingsPatch`/`DefaultSettings()`, and any bound check in
   `SettingsPatch.Validate()` (`:213`).
3. `internal/storage/repos/settings.go` — one `leaf`/`leafValid` line per key in `GetAll` (`:52`-
   `:72`) and one `upsertSettingsLeaf` branch per key in `Set` (`:88`-`:188`).
4. `frontend/src/state/settings.ts` — one `Object.assign` line in `applySettings` (`:66`-`:75`).
5. `frontend/src/workbench/SettingsDialog.vue` — the section name in `state/settings.ts`'s
   `sections` (`:20`-`:31`), the section in `cloneSections` (`:71`-`:80`), a `diffSection` pair in
   `pendingPatch` (`:114`-`:128`), and the markup under `v-else-if="activeSection === '...'"`.
   `isAtDefault`/`resetLeaf` (`:546`-`:551`) are generic and need nothing.

Per-tab request config is one zod object, `httpRequestTabStateShape`
(`packages/shared/domain/http.ts:304`-`:341`), stored by Go as opaque `json.RawMessage`
(`repos/tabs.go:63`) and re-parsed through the schema on restore (`state/tabKinds.ts`'s
`parseState`). **That is why no migration is needed anywhere in this item**: a new field with
`.default(...)` materialises on the next restore of an existing row.

## 2. Design

### 2.1 The global section

New in `packages/shared/domain/settings.ts`, beside `gitSettingsSchema`:

```ts
export const HTTP_VERSIONS = ['1.1', '2'] as const;
export const httpVersionSchema = /*#__PURE__*/ z.enum(HTTP_VERSIONS);
export type HttpVersion = z.infer<typeof httpVersionSchema>;

// 0 = no timeout. Ceiling is one hour — past that a request is a subscription, not a request.
export const REQUEST_TIMEOUT_MS_RANGE = { min: 0, max: 3_600_000 } as const;
// 0 = unlimited. Whole MB, cache.l2BudgetMb's own unit. 2048 is well past any response a
// request builder should be holding in memory and rendering.
export const MAX_RESPONSE_MB_RANGE = { min: 0, max: 2048 } as const;
export const MAX_REDIRECTS_RANGE = { min: 0, max: 100 } as const;

export const apiSettingsSchema = /*#__PURE__*/ z.object({
  httpVersion: httpVersionSchema.default('2'),
  requestTimeoutMs: z.number().int().min(...).max(...).default(0),
  maxResponseMb: z.number().int().min(...).max(...).default(50),
  sslVerify: z.boolean().default(true),
  followRedirects: z.boolean().default(true),
  maxRedirects: z.number().int().min(...).max(...).default(10),
  disableCookieJar: z.boolean().default(true),
});
export type ApiSettings = z.infer<typeof apiSettingsSchema>;
```

Plus `api: apiSettingsSchema.default({...})` in `settingsSchema`, `api:
apiSettingsSchema.partial().optional()` in `settingsPatchSchema`, and the literal in
`defaultSettings`.

Three deliberate default changes from today's behaviour, all stated in the section's own comment:
timeout 30 s → none, max response 10 MiB → 50 MB, max redirects unchanged at 10. The timeout change
is the one with teeth — a hung server now hangs the tab until the user presses Stop, which is what
"default 0/none" asks for and what the Stop button exists for.

`maxRedirects: 0` with `followRedirects: true` means the same as `followRedirects: false`; do not
special-case it, `checkRedirect`'s existing `len(via) >= max` covers it on the first call.

### 2.2 The per-request override

New in `packages/shared/domain/http.ts`, above `httpRequestTabStateShape`:

```ts
// P90: one nullable twin per api settings leaf — null means "inherit the global default", which
// is what a request that has never touched this panel carries. Not a sentinel string and not a
// parallel `inherited` flag: `itemId` (`:335`) and `binaryFile` (`:314`) already spell "absent" as null in this same
// schema, and null is what the wire's own *T pointer decodes from.
export const httpRequestSettingsSchema = /*#__PURE__*/ z.object({
  httpVersion: httpVersionSchema.nullable().default(null),
  requestTimeoutMs: z.number().int().min(0).nullable().default(null),
  maxResponseMb: z.number().int().min(0).nullable().default(null),
  sslVerify: z.boolean().nullable().default(null),
  followRedirects: z.boolean().nullable().default(null),
  maxRedirects: z.number().int().min(0).nullable().default(null),
  disableCookieJar: z.boolean().nullable().default(null),
});
export type HttpRequestSettingsState = z.infer<typeof httpRequestSettingsSchema>;
```

`httpVersionSchema` is imported from `./settings` — `http.ts` already imports nothing from there, so
add the import; `settings.ts` must not import from `http.ts` in return (no cycle either way today).

In `httpRequestTabStateShape`, one field:

```ts
  settings: httpRequestSettingsSchema.default({}),
```

Verify `.default({})` against the pinned zod before relying on it (`paramDescriptions`'s
`z.record(...).default({})` at `:321` is the nearest precedent but is a record, not an object). If
it is rejected, write the seven-null literal out instead — the behaviour must be identical either
way, and an existing stored tab must restore with all seven null.

**Bounds are deliberately looser here than in the global schema** (`min(0)` only, no `max`): a stored
tab row is normalised through this schema on restore and a value outside the range must hydrate
rather than drop the whole tab (`repos/tabs.go` drops a row outright on a failed parse — P3 C3). The
range is enforced where it can be enforced without data loss: the number inputs' `min`/`max`, and
Go's `Options.normalize()` (§2.3), which clamps.

### 2.3 `httpclient.Options`

New file `internal/httpclient/options.go`.

```go
// Options is one send's resolved client configuration (P90 item 1). Every field is a pointer and
// nil means "this package's own default" — never the type's zero value, which for SSLVerify would
// mean "verification off". bridge/http.go always passes a fully-populated Options (§2.5); the nil
// handling exists for this package's own tests and for any future direct caller.
type Options struct {
	HTTPVersion      *string `json:"httpVersion,omitempty"` // "1.1" | "2"
	RequestTimeoutMs *int    `json:"requestTimeoutMs,omitempty"`
	MaxResponseMb    *int    `json:"maxResponseMb,omitempty"`
	SSLVerify        *bool   `json:"sslVerify,omitempty"`
	FollowRedirects  *bool   `json:"followRedirects,omitempty"`
	MaxRedirects     *int    `json:"maxRedirects,omitempty"`
	DisableCookieJar *bool   `json:"disableCookieJar,omitempty"`
	// Ephemeral routes this send's cookies to a throwaway jar instead of the shared one — set by
	// bridge/http.go for an incognito tab (§2.4). Never surfaced in Settings.
	Ephemeral bool `json:"ephemeral,omitempty"`
}

// resolved is Options with every field decided and clamped. Nothing below this line reads Options.
type resolved struct {
	http1            bool
	timeout          time.Duration // 0 = none
	maxResponseBytes int64         // 0 = unlimited
	sslVerify        bool
	followRedirects  bool
	maxRedirects     int
	useJar           bool
	ephemeral        bool
}

func (o Options) normalize() resolved
```

Defaults inside `normalize()` must equal `model.DefaultSettings().Api` field for field. Neither
package may import the other, so state the coupling in a comment on both sides naming the other
file, exactly as `contentTypeByCodeLanguage`/`CONTENT_TYPE_BY_CODE_LANGUAGE` already do
(`body.go` ↔ `http.ts:227`). The existing five constants (`defaultTimeout`, `maxRedirects`,
`maxResponseBytes`) move into `normalize()` as the default values and stop being package constants;
`defaultTimeout`'s `var`-not-const trick (`client.go:29`) is no longer needed once a test can pass
`Options{RequestTimeoutMs: ptr(50)}`.

Clamping, in `normalize()`: `maxRedirects` to `[0, 100]`, `maxResponseMb` to `[0, 2048]`,
`requestTimeoutMs` to `[0, 3_600_000]`, `httpVersion` to `"1.1"` for the literal string `"1.1"` and
HTTP/2 for anything else.

**Transports, cached.** Connection reuse across sends is what `sharedClient` exists for
(`client.go:41`), and a per-send `http.Transport` would throw it away. Only two fields vary per
send, so cache four transports:

```go
type transportKey struct {
	http1     bool
	skipVerify bool
}

var (
	transportsMu sync.Mutex
	transports   = map[transportKey]*http.Transport{}
)

func transportFor(k transportKey) *http.Transport
```

Each built once, lazily:

```go
tr := &http.Transport{Proxy: http.ProxyFromEnvironment}
p := new(http.Protocols)
p.SetHTTP1(true)
if !k.http1 {
	p.SetHTTP2(true)
}
tr.Protocols = p
if k.skipVerify {
	// The only place in this app that turns certificate verification off. Reachable only from an
	// explicit per-request or global "SSL certificate verification: off", never a default, and
	// the request editor shows a warning chip while it is off (§2.6).
	tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
}
```

`SetUnencryptedHTTP2` stays off: HTTP/2 negotiates over ALPN on `https://` only, which is today's
behaviour and what the setting means. Say so in a comment so nobody "fixes" it later.

`sharedClient` (`client.go:45`-`:50`) is **deleted**. Each send builds its own `*http.Client` over
the cached transport:

```go
client := &http.Client{
	Transport:     transportFor(transportKey{http1: r.http1, skipVerify: !r.sslVerify}),
	CheckRedirect: checkRedirectFor(r),
	Jar:           jarFor(r),
}
```

An `http.Client` value is three fields; building one per send costs nothing and is what lets
`CheckRedirect` and `Jar` vary without a third context key.

`checkRedirect` (`client.go:119`) becomes `checkRedirectFor(r resolved) func(*http.Request,
[]*http.Request) error`, a closure over `r`, with two changes to its body and nothing else touched:

```go
if !r.followRedirects {
	// Before closeHop: net/http returns the 3xx itself as the response, so this hop is the
	// *final* hop and finishFinal (client.go:432) is what closes it. Closing it here too would
	// record it twice.
	return http.ErrUseLastResponse
}
if len(via) >= r.maxRedirects {
	return fmt.Errorf("httpclient: stopped after %d redirects", r.maxRedirects)
}
```

The cross-host header-stripping block (`:130`-`:144`) and the `tl.closeHop` call (`:123`-`:128`) are
unchanged and stay in that order.

`Send`'s signature becomes `Send(ctx context.Context, req Request, opts Options) (Response, error)`.
Inside:

- `:269` — `sendCtx, cancel := context.WithTimeout(ctx, r.timeout)` only when `r.timeout > 0`;
  otherwise `sendCtx, cancel := context.WithCancel(ctx)`. Both branches still `defer cancel()`, and
  `classifySendErr` (`:208`) needs no change — with no deadline, `sendCtx.Err()` can only ever be
  `context.Canceled`, which is exactly the branch it already has.
- `:385` — `resp, err := client.Do(httpReq)`.
- `:391` — `var reader io.Reader = resp.Body; if r.maxResponseBytes > 0 { reader =
  io.LimitReader(resp.Body, r.maxResponseBytes+1) }`, and the truncation check at `:397` guards on
  `r.maxResponseBytes > 0 && int64(len(data)) > r.maxResponseBytes`.

The three existing `Send` call sites pass `httpclient.Options{}` (tests) except `bridge/http.go`.

### 2.4 The cookie jar

New file `internal/httpclient/cookies.go`.

```go
// sharedJar — one process-wide, in-memory cookie jar (P90 item 1/2). Not persisted: nothing about
// it reaches kira.sqlite, and it dies with the process. Host-keyed by the stdlib, so two
// environments pointing at different hosts can never share a session cookie; two environments
// pointing at the *same* host deliberately do, which is what a cookie jar means.
//
// publicsuffix.List is not optional: cookiejar.New(nil) accepts a Set-Cookie for Domain=com and
// replays it to every .com host (the stdlib's own documented warning). golang.org/x/net is already
// in go.sum as an indirect dependency; this promotes it to direct. BSD-3-Clause, fully open source.
var sharedJar = mustJar()

func mustJar() *cookiejar.Jar {
	jar, err := cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
	if err != nil {
		// cookiejar.New's only error path is a nil Options, which cannot happen here.
		panic(fmt.Sprintf("httpclient: cookie jar: %v", err))
	}
	return jar
}

func jarFor(r resolved) http.CookieJar {
	switch {
	case !r.useJar:
		return nil
	case r.ephemeral:
		// P71 incognito: cookies still work across this send's own redirect chain, nothing is
		// retained afterwards.
		return mustJar()
	default:
		return sharedJar
	}
}
```

Exported for the bridge:

```go
// Cookie is one cookie, sent or received. Expires is RFC3339 or "" for a session cookie; SameSite
// is "", "lax", "strict" or "none".
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Expires  string `json:"expires"`
	MaxAge   int    `json:"maxAge"`
	Secure   bool   `json:"secure"`
	HttpOnly bool   `json:"httpOnly"`
	SameSite string `json:"sameSite"`
	// Hop is the timeline hop index this cookie was sent on or received from (0 for the first).
	Hop int `json:"hop"`
}

// JarCookies lists what the shared jar would send to rawURL right now.
func JarCookies(rawURL string) ([]Cookie, error)

// DeleteJarCookie removes one cookie from the shared jar for rawURL's host. cookiejar has no
// delete API, so this is an expiring Set: SetCookies with the same name, MaxAge -1.
func DeleteJarCookie(rawURL, name string) error

// ClearJar replaces the shared jar wholesale — cookiejar has no Clear.
func ClearJar()
```

`ClearJar` needs `sharedJar` to become a mutex-guarded `var` rather than a plain one, since a send
may be reading it concurrently. Guard it with a `sync.RWMutex` and read it through an accessor;
`jarFor` uses the accessor.

`JarCookies` maps `jar.Cookies(u)` (which returns `[]*http.Cookie` carrying name/value only — the
jar does not expose domain/path/expiry) onto `Cookie` with the other fields left zero, and says so
in a comment. That is a real limitation of `net/http/cookiejar`, not a shortcut: the alternative is
vendoring a jar implementation, which is not worth it for a display column. The **response**-side
cookie list (below) is the one that carries the full attribute set, and that is the list the user
actually reads them from.

### 2.4b Cookies on the response

Two new fields on `Response` (`client.go:87`-`:107`), both `omitempty`:

```go
	// SentCookies/ReceivedCookies are P90 item 2. Sent is what actually went out per hop, captured
	// from httptrace's WroteHeaderField (the jar injects Cookie inside net/http, after
	// CheckRedirect, so there is nowhere else to read it). Received is every hop's Set-Cookie,
	// parsed by the stdlib.
	SentCookies     []Cookie `json:"sentCookies,omitempty"`
	ReceivedCookies []Cookie `json:"receivedCookies,omitempty"`
```

Sent: add a `WroteHeaderField` hook to `tl.trace()` in `timeline.go` recording `key == "Cookie"`
(case-insensitively; `textproto` is already imported there) against the current hop, and parse each
recorded value with `(&http.Request{Header: http.Header{"Cookie": {v}}}).Cookies()`. Hop attribution
falls out of the existing per-hop bucketing for free.

Received: parse in `Send` from `resp.Header` for the final hop, and in `closeHop` from
`req.Response.Header` for each intermediate hop — **before** `maxHopHeaderBytes` elides anything
(`timeline.go:18`), so a long `Set-Cookie` never silently vanishes from the Cookies tab.
`(&http.Response{Header: h}).Cookies()` is the parser; nothing hand-rolled.

`maskSecrets` (`bridge/http.go:231`) must extend to both new slices' `Value` fields — a secret in a
request is at least as likely to be a session token as a header value, and this is a new copyable
surface reaching kira.sqlite via `ResponseHistory.Record`. Add the two loops beside the existing
`resp.Headers` loop at `:246`.

### 2.5 Resolution, in `bridge/http.go`

`HttpSendArgs` (`:35`) gains one field:

```go
	// Options is P90 item 1: per-request overrides, every field nil for "inherit the global
	// default". Resolved against the persisted settings below, never used as sent.
	Options httpclient.Options `json:"options"`
```

In `Send` (`:66`), before the `RunOp` call — the globals are read once per send, from the same
repo the Settings dialog writes:

```go
settings, err := s.Deps.Repos.Settings.GetAll()
if err != nil {
	return httpclient.Response{}, ipcerr.Internal(err.Error())
}
opts := resolveSendOptions(settings.Api, args.Options, args.Incognito)
```

```go
// resolveSendOptions is P90's whole override rule: a per-request value wins, an absent one
// inherits the global. Seven independent leaves, no interaction — which is exactly why this is not
// a unit test (CLAUDE.md's bar; §7.1).
func resolveSendOptions(g model.ApiSettings, o httpclient.Options, incognito bool) httpclient.Options {
	out := httpclient.Options{
		HTTPVersion:      orGlobal(o.HTTPVersion, g.HTTPVersion),
		RequestTimeoutMs: orGlobal(o.RequestTimeoutMs, g.RequestTimeoutMs),
		MaxResponseMb:    orGlobal(o.MaxResponseMb, g.MaxResponseMb),
		SSLVerify:        orGlobal(o.SSLVerify, g.SSLVerify),
		FollowRedirects:  orGlobal(o.FollowRedirects, g.FollowRedirects),
		MaxRedirects:     orGlobal(o.MaxRedirects, g.MaxRedirects),
		DisableCookieJar: orGlobal(o.DisableCookieJar, g.DisableCookieJar),
	}
	out.Ephemeral = incognito
	return out
}

func orGlobal[T any](override *T, global T) *T {
	if override != nil {
		return override
	}
	return &global
}
```

`resolveSendOptions` and `orGlobal` go in `bridge/http.go`, not in `httpclient` — `httpclient` must
not learn about `model`.

Two new bound methods on `HttpService`, both thin:

```go
type HttpCookiesArgs struct{ URL string `json:"url"` }

func (s *HttpService) Cookies(args HttpCookiesArgs) ([]httpclient.Cookie, error)
func (s *HttpService) DeleteCookie(args HttpCookieDeleteArgs) ([]httpclient.Cookie, error) // returns the remaining list
func (s *HttpService) ClearCookies() error
```

Each maps a `httpclient` error through `ipcerr.BadRequest`/`ipcerr.Internal` the way `Send` already
does. These do **not** go through `RunOp` — they touch no connection, issue no network I/O, and have
nothing to cancel or log; `SettingsService` is the precedent for a bound service that just reads.

### 2.6 The per-request Settings panel

`httpRequestPaneSchema` (`http.ts:273`) widens from `['params','headers','body']` to
`['params','headers','body','settings','cookies']`. `httpResponsePaneSchema` (`:281`) gains
`'cookies'`. Both widenings are safe for the reason P8 D10/P9 D12/P10 D11 already verified three
times over on the response enum, and which their comments state: every previously-stored value is
still a member.

`HttpRequestView.vue`:

- `REQUEST_PANE_OPTIONS` (`:286`-`:303`) gains two entries. The Settings segment's label carries a
  count badge the same way Params/Headers already do — `Settings (3)` when three leaves are
  overridden, bare `Settings` at zero — computed as
  `Object.values(tab.state.settings).filter((v) => v !== null).length`. The Cookies segment carries
  the count of cookies the jar would send for this URL (§3.1), bare `Cookies` at zero.
- `setRequestPane` (`:305`) widens its parameter type to `HttpRequestPane` (the schema type, not an
  inline literal union — `ResponsePane.vue:89` is the precedent).
- The `v-if`/`v-else-if` chain at `:561`-`:580` gains two branches ahead of the `v-else`
  `RequestBodyPane`.
- `showFieldFilterToggle` (`:322`-`:328`) must exclude the two new panes: it currently reads
  `requestPane !== 'body' || bodyMode is a row table`, which would leave the field filter and the
  description toggle on screen over a pane with no rows to filter. Rewrite as an explicit
  allow-list: `requestPane === 'params' || requestPane === 'headers' || (requestPane === 'body' &&
  (bodyMode === 'urlencoded' || bodyMode === 'formdata'))`.
- A warning chip beside the Send button while this request's *effective* `sslVerify` is false —
  `tab.state.settings.sslVerify ?? settingsState.api.sslVerify`. `MessageStrip.vue` is too heavy for
  the toolbar; use the same inline chip shape the incognito chip already uses (`:491`), icon
  `unverified`, tooltip "Certificate verification is off for this request".

New `frontend/src/views/httprequest/RequestSettingsPane.vue`. A `<label class="field">` per leaf,
same shape as `SettingsDialog.vue`'s own fields, in SPEC's own order. Each row is three things:

1. A checkbox or select/number control bound to `tab.state.settings.<leaf>`.
2. An "Inherit" `Checkbox.vue` — checked means the leaf is `null`. Unchecking seeds the leaf with the
   current global value, so the control never starts blank; checking it writes `null` back.
3. Helper text naming the inherited value: `Global: 50 MB`, read straight from
   `settingsState.api` (`state/settings.ts`'s reactive mirror). No resolver function — the rule is
   one `??` per leaf and writing it twice as a function would be the drift risk, not the fix.

Writes go through `patchHttpRequestTabState(props.tab.id, { settings: { ...tab.state.settings,
<leaf>: v } })` — the tab patch helper is shallow, so the whole object is replaced each time.

A footer link, "Edit global defaults…", calling `openSettingsAt('Api')` (`state/settings.ts:41`,
P85's own precedent) — that is what makes the new Settings section discoverable from where the user
is actually standing.

Controls: `httpVersion` a `select.p-select` (HTTP/1.1, HTTP/2); `requestTimeoutMs`/`maxResponseMb`/
`maxRedirects` a `TextField type="number"` with `:min`/`:max` from the exported ranges;
`sslVerify`/`followRedirects`/`disableCookieJar` a `Checkbox.vue`. `maxRedirects` disabled (with its
own helper line saying why) while the effective `followRedirects` is false.

`data-testid`s: `http-settings-<leaf>` and `http-settings-<leaf>-inherit`.

### 2.7 The global Settings section

`state/settings.ts` — `'Api'` in `sections` (`:20`-`:31`), placed after `'Cache'`; `api` added to
`applySettings`'s `Object.assign` list (`:66`-`:75`).

`SettingsDialog.vue` — `api: s.api` in `cloneSections` (`:71`-`:80`), a `diffSection(baseline.api,
draft.api)` pair in `pendingPatch` (`:114`-`:128`), and a
`<template v-else-if="activeSection === 'Api'">` block modelled on the `'Cache'` block (`:973`), one
`<label class="field">` per leaf with the `IconButton icon="discard"` reset control and
`isAtDefault('api', '<leaf>')`/`resetLeaf('api', '<leaf>')` wired exactly as every other leaf's is.

`data-testid`s: `settings-api-<leaf>`, `settings-reset-api-<leaf>`.

The `sslVerify` field gets a `field-error`-styled (not red-on-save, just visible) helper line while
it is off, in plain prose rather than this repo's terse style — it is a security warning:

> Turning certificate verification off lets any server present any certificate. Anything on the
> network between you and the server can then read and modify every request and response, including
> credentials. Leave this on unless you are testing against a server with a self-signed certificate
> you control.

### 2.8 Sending it

`frontend/src/bridge/apiControl.ts` — `httpSend`'s arg type (`:68`-`:82`) gains
`options?: HttpRequestSettingsWire`, forwarded as `args.options ?? {}`. A new
`HttpRequestSettingsWire` type in `packages/shared/domain/http.ts` mirroring `httpclient.Options`'s
JSON shape (optional fields, not nullable ones — Go decodes an absent key to nil, and `null` to nil
too, so either serialises correctly; optional keeps the payload smaller).

`views/httprequest/state.ts`'s `send()` (`:171`-`:184`) builds it from `tab.state.settings` by
dropping the nulls:

```ts
function buildSettingsWire(s: HttpRequestSettingsState): HttpRequestSettingsWire {
  const out: HttpRequestSettingsWire = {};
  for (const [k, v] of Object.entries(s)) if (v !== null) (out as Record<string, unknown>)[k] = v;
  return out;
}
```

New bound calls in `apiControl.ts`: `httpCookies(url)`, `httpDeleteCookie(url, name)`,
`httpClearCookies()`, each `unwrap(...)`+`trust<...>` like their neighbours.

Test-harness registration for all three, or every `tests/ui` spec that touches them fails at the
bound call: `tests/ui/support/ipcChannels.ts` (`:69`'s neighbourhood — `kira:http:cookies`,
`kira:http:cookies:delete`, `kira:http:cookies:clear`) and `tests/ui/support/mockRuntime.ts`'s
`CHANNEL_TO_FQN` (`:81`'s neighbourhood — `HttpService.Cookies`, `HttpService.DeleteCookie`,
`HttpService.ClearCookies`).

Regenerate bindings after the Go method set changes: `wails3 task common:generate:bindings`, never a
hand-typed flag list (`docs/DEV_ENVIRONMENT.md:243`-`:257` — `-names` is load-bearing).

---

# Item 2 — the Cookies tab

Lands **after** item 1: it reads `httpclient.JarCookies` and `Response.SentCookies`/
`ReceivedCookies`, neither of which exists before item 1's commits.

## 3. One component, two hosts

`frontend/src/views/httprequest/CookiesPane.vue`, rendered by both `HttpRequestView.vue` (request
segment) and `ResponsePane.vue` (response segment), with a `mode: 'request' | 'response'` prop.

Markup reuses the response headers pane verbatim as the list shape (`ResponsePane.vue:383`-`:406` +
its `.response-headers*` CSS at `:495`-`:515`): a `PanelSearchBox` filter, an "N of M" count when
filtered, then a scrolling column. A cookie is more than a name/value pair, so each row is a
`.p-kv-row` whose value cell carries the value on the first line and the attributes
(`Domain=… Path=… Expires=… Secure HttpOnly SameSite=Lax`) as a second, `--kira-fg-muted` line —
the same two-tier shape `AutocompleteField.vue`'s hover panel already uses (`.hover-line +
.hover-line`, `:654`). Do not build a grid; this is a list.

### 3.1 Request mode

Shows what the jar would send for this tab's current URL — the answer to "will my session cookie go
out on the next send". Fetched through `control.httpCookies(url)`:

- on mount, and on the tab's resolved URL changing (debounced 300 ms — the URL field fires per
  keystroke; `SearchToolbar.vue`'s own debounce is the in-repo shape to copy);
- after every send that completes, so a `Set-Cookie` shows up without the user re-navigating —
  hook the existing `noteSendRecorded(tabId)` call site in `state.ts:191`, or a sibling notifier
  beside it;
- never when the effective `disableCookieJar` is true. In that case render an `EmptyState` saying
  the cookie jar is off for this request, with the same "Edit global defaults…" link
  (`openSettingsAt('Api')`) — an empty list with no cause is exactly what P24 D7 rules against.

Per row, a remove `IconButton icon="close"` (`httpDeleteCookie`), and a "Clear all" button in the
pane's own header (`httpClearCookies`). Both refetch on success.

Runtime-only, component-local: nothing here is tab state, nothing is persisted.

### 3.2 Response mode

Pure projection of `response.sentCookies`/`response.receivedCookies` — no IPC at all, so a history
snapshot (`ResponseHistoryList.vue`'s `viewing`) renders its own cookies exactly like a live
response. Two labelled groups, Sent first then Received, each with the hop index shown when the
response has more than one hop (`response.timeline?.hops.length > 1`). `EmptyState` when the
response carries neither, and the existing "Send a request to see the response" `EmptyState`
(`ResponsePane.vue:405`) when there is no response.

`ResponsePane.vue` changes: one entry in `RESPONSE_PANE_OPTIONS` (`:75`-`:84`), labelled
`Cookies (N)` when `N > 0`, and one `v-else-if` branch beside the headers branch.

---

# Item 3 — the multi-line grow field

## 4. What the mechanism actually is

P71 §8's opt-in `grow` prop turns the control into a `<textarea>` and sizes it with a CSS grid
replica — `primitives.css:186`-`:227`, `TextField.vue:88`-`:156`, `AutocompleteField.vue:440`-`:511`.
SPEC's guess is right about the mechanism:

- `.input-wrap` becomes `display: grid` (`primitives.css:206`-`:208`).
- `.input-wrap::after` is the replica: `content: attr(data-value) " "`, `grid-area: 1 / 1`,
  `visibility: hidden`, `white-space: pre-wrap`, `overflow-wrap: anywhere`, `font: inherit`,
  `max-height: calc(4 * 1.45 * 1em)`, `overflow: hidden` (`:213`-`:222`). `data-value` is bound to
  `modelValue` on the wrapper (`TextField.vue:95`, `AutocompleteField.vue:446`).
- `.input-wrap > textarea` sits in the same grid area, `resize: none`, `overflow-y: auto`
  (`:223`-`:227`), stretched by the grid to whatever height the replica's clamped contribution sized
  the single auto row to.

That trick is sound. What is broken is that the three boxes stacked in that one grid area — replica,
textarea, and (on every variable-aware field) the highlight overlay — do not agree about their own
geometry. Three independent defects, which together produce all three reported symptoms.

## 4.1 Defect A — the transparency rule never matches a textarea (the duplication)

`AutocompleteField.vue:618`:

```css
.input-wrap input.has-overlay {
  position: relative;
  z-index: 1;
  color: transparent;
  caret-color: var(--kira-fg);
}
```

The `has-overlay` class **is** bound on the grow textarea (`:468`), but the selector's type
component is `input`, which never matches `<textarea>`. So under `grow` + an overlay:

- the textarea's own text stays fully opaque (`color: inherit` from `.p-input textarea`,
  `primitives.css:176`-`:185`), while `.highlight-overlay` paints the same characters in the same
  place. **Two copies of the value, always.**
- the textarea also loses `position: relative; z-index: 1`, so it is a non-positioned in-flow grid
  item while the overlay is `position: absolute` (`:567`-`:569`) — the overlay paints *above* it,
  inverting the stacking P60a's design depends on. `onInputMouseMove`'s pointer-events flip
  (`:385`-`:392`) is written for the opposite order and is a no-op-to-wrong in this state.

Which fields: every `grow` cell that also has variable support — `FieldRowsTable.vue:292` (name),
`:321` (value), `FormDataTable.vue:99`/`:111`, `MetadataTable.vue:228`-`:262`. That is the headers/
params/form-data/gRPC-metadata tables SPEC names. A `grow` `TextField` (the description column,
`FieldRowsTable.vue:346`) has no overlay and is unaffected by this defect — it is still affected by
C below.

## 4.2 Defect B — the two copies use different line boxes (why it only shows once the value wraps)

`.highlight-overlay` pins `line-height: normal` (`:575`). `.p-input.is-grow` sets `line-height: 1.45`
(`primitives.css:193`), which the textarea inherits through `.p-input textarea { font: inherit }`.
`.autocomplete-field.is-grow .highlight-overlay` (`:607`-`:611`) corrects `display`, `white-space`
and `overflow-wrap` for the grow case — and not `line-height`.

`normal` is ~1.2 for the data font stack. So:

| Line | Overlay baseline | Textarea baseline | Drift at 12 px |
|---|---|---|---|
| 1 | 0 | 0 | 0 |
| 2 | 1.2 em | 1.45 em | ~3 px |
| 3 | 2.4 em | 2.9 em | ~6 px |
| 4 | 3.6 em | 4.35 em | ~9 px |

One line: the two copies are within a pixel, which reads as slightly heavy text — which is why P71
shipped and nobody noticed. Two or more lines: two visibly offset copies, drifting further down the
box. **"The displayed text duplicates" and "the cursor lands on the wrong line" are the same defect
seen twice** — the caret is exactly where the *textarea* puts it, and the user is reading the
overlay's copy, which by line 3 is most of a line higher.

`onInputScroll` (`:317`-`:325`) copies `el.scrollTop` onto the overlay root verbatim. With different
line heights, equal pixel offsets are different lines, so scrolling makes the divergence worse
rather than tracking it — the third symptom.

## 4.3 Defect C — the replica is not the textarea's box (why the box is always a line short)

`.p-input input, .p-input textarea` (`primitives.css:176`-`:185`) resets background, border, outline,
colour, font, `min-width` and `flex` — **not padding**. Both Blink and WebKit give `<textarea>` a UA
default `padding: 2px`. The `::after` replica has none. Consequences, all real and all in the same
direction:

- The textarea's content box is ~4 px narrower than the replica's, so it wraps **earlier** and holds
  more lines than the replica measured.
- Its content box is also 4 px shorter than the grid track, so even at exactly four replica-lines it
  cannot display four textarea-lines.
- So the textarea begins scrolling before the box has finished growing, at a boundary that moves
  with the font size — the "scrolling inside it doesn't work" report. There *is* scrolling; the box
  is short by an amount the replica can never see, so the content never settles.

`.p-input.is-grow`'s `padding-block` formula (`:199`-`:202`) derives the one-row centring from
`--kira-control-h - 2*border - 1.45em`, i.e. it already assumes the line box is exactly `1.45em` with
nothing else inside — true only once the textarea's own padding is gone.

The replica also sets `overflow-wrap: anywhere` where the textarea uses the UA default, so a long
unbroken token (a JWT, a base64 header value — exactly what these cells hold) breaks in the replica
and not in the textarea, adding a second, content-dependent line-count disagreement on top.

Scrollbar gutter is **not** part of this: both shipped webviews (WKWebView on macOS, WebKitGTK on
Linux — `docs/ARCHITECTURE.md`'s platform set) use overlay scrollbars, which take no layout width.
Checked deliberately rather than assumed, since a reserved gutter would have been a fourth,
unfixable-in-CSS measurement mismatch.

## 4.4 Fix, not replace

Replacement is authorised by SPEC and declined here on the evidence:

- Nothing found is inherent to the grid-replica trick. It is the standard pattern, it is what
  `field-sizing: content` (Chromium-only; this app also ships WebKitGTK/WKWebView, which is exactly
  why P71 declined it, `primitives.css:186`-`:189`) would replace, and every defect above is two
  boxes disagreeing about metrics the pattern requires to be identical.
- A JS autosize library fixes **none** of Defect A or B — the overlay/textarea duplication is
  independent of how the box gets its height — and reintroduces the per-keystroke inline-height
  write across a table of dozens of rows that P71 declined for a stated reason. Swapping the sizing
  mechanism would leave the actual reported bug on screen.

So the fix makes the three boxes share one geometry. Five small edits, no new mechanism.

### 4.5 The edits

`apps/kira-studio/frontend/src/theme/primitives.css`, the `.p-input.is-grow .input-wrap > textarea`
rule (`:223`-`:227`):

```css
.p-input.is-grow .input-wrap > textarea {
  grid-area: 1 / 1;
  resize: none;
  overflow-y: auto;
  /* P90: the UA gives a textarea `padding: 2px`, which the plain `.p-input textarea` reset above
     does not clear. The ::after replica that sizes this grid track has none, so the textarea wrapped
     ~4px earlier than the replica measured and was ~4px shorter than the track it was stretched to
     — it scrolled before the box finished growing, at a boundary that moved with the font size.
     These three declarations are what make the replica's box and this one the same box. */
  padding: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

`apps/kira-studio/frontend/src/theme/primitives/AutocompleteField.vue`:

- `:618` — `.input-wrap input.has-overlay` becomes
  `.input-wrap input.has-overlay,\n.input-wrap textarea.has-overlay`. The class is already bound on
  both elements (`:468`, `:492`); only the rule's type selector excluded the textarea. Amend the
  rule's comment to say the overlay is painted *behind* whichever of the two is rendered.
- `:607`-`:611` — add `line-height: inherit;` to `.autocomplete-field.is-grow .highlight-overlay`,
  with a comment: it picks up `1.45` from `.p-input.is-grow`, where a `grow` textarea's own line
  height comes from; `line-height: normal` at `:575` stays for every non-grow field, so no
  single-line field moves by a pixel.
- No padding rule is needed on the overlay. It is `inset: 0` on `.input-wrap`, and the textarea is
  now zero-padded inside the same box, so the two first glyphs land on the same pixel. Say so in the
  comment, so nobody adds a compensating offset later.

Nothing in `TextField.vue` changes — its `grow` path has no overlay, and Defect C is fixed in
`primitives.css` for both components at once.

No JS changes. `onInputScroll` becomes exact once the line heights match; the hover hit-test's
pointer-events flip becomes correct again once `z-index: 1` is restored.

### 4.6 Blast radius

`grep -rn` for the `grow` prop finds ten call sites, all row-table cells: `FieldRowsTable.vue:292`,
`:304`, `:321`, `:333`, `:346`; `FormDataTable.vue:99`, `:111`; `MetadataTable.vue:228`, `:240`,
`:252`, `:262`. Every edit above is scoped to `.is-grow` or `.has-overlay`:

- The `> textarea` rule already only matched `grow` fields.
- The `line-height` addition is under `.autocomplete-field.is-grow`.
- The `has-overlay` widening is the only edit touching a selector without `is-grow` in it. It adds
  `textarea.has-overlay`, and a `<textarea>` carrying `has-overlay` exists **only** under `grow`
  (`AutocompleteField.vue:460`-`:461`). No non-grow field can match the new half of the selector.

So no field without `grow` changes at all, and the ten that have it change only in the direction of
the four-row behaviour P71 documented and never actually achieved past one line.

---

## 5. Order of work

Ten commits. Items 1→2 is a hard dependency; item 3's two commits are independent of both and can be
interleaved anywhere.

1. `feat(settings): add the Api section — seven request settings, global` — §2.1, §2.7, plus the Go
   mirror (`model/settings.go`, `repos/settings.go`) and `state/settings.ts`. Nothing reads them yet.
2. `refactor(httpclient): take per-send Options instead of five package constants` — §2.3's
   `options.go`, `Send`'s signature, the three call sites, `checkRedirectFor`, the transport cache.
   No behaviour change when `Options{}` is passed except the three new defaults, which this commit
   is the right place to land and state.
3. `feat(httpclient): add an in-memory cookie jar behind the disable-cookie-jar option` — §2.4.
4. `feat(api): resolve per-request settings against the global defaults` — §2.2's schema, §2.5's
   `bridge/http.go` resolution, §2.8's wire/`state.ts`/`apiControl.ts`/harness plumbing.
5. `feat(api): add the request editor's Settings panel` — §2.6.
6. `feat(httpclient): report the cookies each hop sent and received` — §2.4b, plus `maskSecrets`.
7. `feat(api): add the Cookies tab to the response viewer` — §3.2.
8. `feat(api): add the Cookies tab to the request editor` — §3.1, plus the three bound methods and
   their harness entries.
9. `fix(theme): give a grow field's textarea the replica's own box` — §4.5's `primitives.css` edit.
10. `fix(theme): stop a grow field painting its value twice` — §4.5's two `AutocompleteField.vue`
    edits.

Conventional Commits; each message ends with the two attribution lines this session uses.
Regenerate bindings (§2.8) in whichever of commits 4/8 first changes `HttpService`'s method set, and
commit the regenerated `frontend/bindings/**` with it — they are real Vite import targets.

## 6. Tests

### 6.1 Go — extend `internal/httpclient/client_test.go`

These clear `CLAUDE.md`'s bar: interacting rules (redirect policy × header stripping × hop
recording, jar × redirect × cross-host, timeout × cancel classification), driven against a real
`httptest.Server`, in the package that already tests exactly this way. Six tests:

- `TestSend_FollowRedirectsOff` — `Options{FollowRedirects: ptr(false)}` against the existing
  redirect chain fixture (`:17`): `Status` is the 301 itself, `Redirects` is empty, `FinalURL` is the
  original URL, and `Timeline.Hops` has exactly one hop. This is the assertion that catches the
  `ErrUseLastResponse`-before-`closeHop` ordering (§2.3) if it is written the other way round.
- `TestSend_MaxRedirectsHonoured` — a 3-hop chain with `MaxRedirects: ptr(1)`: the send fails with
  `CodeHTTPTransport` and a message containing `stopped after 1 redirects`.
- `TestSend_BodySizeTruncation` — **rewrite the existing test** (`:111`-`:133`) to pass
  `Options{MaxResponseMb: ptr(1)}` rather than allocate the default. Add a second case with
  `MaxResponseMb: ptr(0)` asserting a >1 MB body comes back whole and `BodyTruncated` false.
- `TestSend_TimeoutZeroMeansNone` — beside the existing `TestSend_TimeoutVsCancellation` (`:161`),
  which keeps working with `RequestTimeoutMs: ptr(50)` in place of the `defaultTimeout` var swap
  (`:174`-`:176`). Asserts a server sleeping past any old default still returns, and that cancelling
  the caller's ctx still classifies `CodeCancelled`.
- `TestSend_CookieJarReplaysAcrossSends` — server sets a cookie on `/login` and asserts its presence
  on `/me`. Three cases in one table: jar off (default) → no cookie on the second send; jar on →
  cookie present, and `SentCookies` names it; jar on with `Ephemeral: true` → cookie present within
  one send's own redirect chain but absent on the next send. Call `ClearJar()` between cases — the
  shared jar is package state and these tests would otherwise be order-dependent.
- `TestSend_ForcedHTTP1` — an `httptest.NewUnstartedServer` with `EnableHTTP2 = true`:
  `HTTPVersion: ptr("2")` yields `resp.Proto == "HTTP/2.0"`, `ptr("1.1")` yields `"HTTP/1.1"`. This
  is the only check that `Protocols` is wired the way §2.3 claims.

### 6.2 What gets no unit test

Per `CLAUDE.md`'s bar, explicitly:

- `resolveSendOptions`/`orGlobal` — seven independent `x != nil ? x : global` leaves with no
  interaction. It mostly restates its own body.
- The settings leaf read/write — a CRUD round-trip through an existing, already-tested repo shape.
- `cookiesFromHeader` — a wrapper around `http.Response.Cookies()`.
- Every Vue component in this phase. Reactivity and CSS; `bun test` cannot reach either.

### 6.3 Playwright — `apps/kira-studio/tests/ui/`

Add to the existing `http-request.spec.ts` (it already has the `openHttpModeAndNewRequest` helper and
a mocked `httpSend`), except where noted:

- **Settings section round-trip** — open Settings, switch to Api, change `maxResponseMb`, Save,
  assert one `settingsSet` call carrying `{ api: { maxResponseMb: … } }` and nothing else.
  `settings.spec.ts` if one exists for that dialog; otherwise here.
- **Override reaches the wire** — open the Settings segment, uncheck Inherit on `followRedirects`,
  set it false, send, assert the single `httpSend` call's `options` is exactly
  `{ followRedirects: false }` — every un-overridden leaf absent, which is the assertion that the
  `null`-dropping in `buildSettingsWire` is real and not an all-fields payload.
- **Override survives a restore** — `relaunch` with the tab persisted, assert the Settings segment
  still shows the override and its count badge reads 1.
- **Response Cookies tab** — a mocked response carrying `sentCookies`/`receivedCookies`; assert both
  groups render and the attribute line shows `HttpOnly`.
- **Request Cookies tab, jar off** — with `disableCookieJar` at its default, the pane shows the
  cookie-jar-is-off empty state and issues no `httpCookies` call.
- **The grow fix** — the one thing only a browser can check, and the one item-3 assertion that
  fails on the current tree:
  ```
  fill a headers *value* cell with text long enough to wrap to 3 lines
  -> the cell's <textarea> and its .highlight-overlay report the same
     getClientRects()[2].top (within 1px)         # defect B
  -> the textarea's own scrollHeight <= its clientHeight at 3 lines   # defect C
  -> click near the end of the visible 3rd line; selectionStart lands
     in the 3rd line's character range, not the 2nd                   # the reported symptom
  ```
  Read the line ranges via `evaluate` over the textarea's value and a `Range` on the overlay rather
  than hard-coding character offsets, so the test does not encode a font metric.

## 7. Verification

Per commit (fast, cheap):

- `go build ./... && go vet ./...`
- `bun run typecheck`, `bun run lint`, `bun run build`
- On the commit that changes `HttpService`'s method set, `wails3 task common:generate:bindings`
  first — a missing binding fails the Vite build with an unresolvable import.

Once, near the end of the phase (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `go test ./apps/kira-studio/internal/httpclient/... ./apps/kira-studio/internal/bridge/... ./apps/kira-studio/internal/storage/...`
  — §6.1 is the real verification for item 1's plumbing, and it is cheap (local `httptest`, no
  container, no network).
- `bun run build:test`, then `playwright test --config=apps/kira-studio/playwright.config.ts
  --project=ui -g "Http request"` plus the settings spec. The `ui` project runs **webkit**
  (`playwright.config.ts:49`), which this container does not preinstall — `docs/DEV_ENVIRONMENT.md
  :336`-`:341` has `bunx playwright install webkit` and the system libraries it needs. Run the full
  `bun run test:ui` if time allows.
- Manual, in `bun run dev`, for what Playwright cannot assert:
  1. A real request against a server that 301s twice: redirects followed by default, chain shown in
     Timeline; `followRedirects` off on this one request returns the 301 itself.
  2. `disableCookieJar` off globally, log in against a real cookie-setting endpoint, then hit a
     second endpoint — the Cookies tab lists the session cookie in both the request and the response
     panes, and "Clear all" empties it.
  3. `sslVerify` off on one request against a self-signed host: it succeeds, the warning chip shows,
     and every other tab still verifies.
  4. `httpVersion` 1.1 against an h2 host: the response's Proto reads `HTTP/1.1` and the Raw pane's
     fidelity flips from `http2` to `exact`.
  5. A header value long enough to wrap to two, three and five lines: one copy of the text, the box
     grows to four rows and stops, scrolling past four rows works with the wheel and with the caret,
     and clicking any visible line puts the caret on that line. Check at font size 9 and 24 (both
     ends of `FONT_SIZE_RANGE`) — the padding defect scaled with font size, so a fix that only works
     at 12 px is not a fix.

Do not commit a screenshot or a findings document; the commit log is the record.

## 8. Out of scope

- gRPC request settings. `views/grpcrequest/**` gets item 3's shared-primitive fix and nothing else.
- Persisting the cookie jar, editing a cookie by hand, and any cookie UI beyond list/delete/clear.
- The `wire`/`timeline` panes' own rendering, `maxHopHeaderBytes`, and P9's fidelity classification —
  untouched except that `classifyFidelity` now sees HTTP/1.1 more often, which it already handles.
- `localDoc`-style editor plumbing, the body editors, the URL field: none of them use `grow`.
- Any retroactive change to the five settings' behaviour for a request that overrides none of them,
  beyond the three default changes §2.1 names explicitly.
