package httpclient

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Options is one send's resolved client configuration (P90 item 1). Every field is a pointer and
// nil means "this package's own default" — never the type's zero value, which for SSLVerify would
// mean "verification off". bridge/http.go always passes a fully-populated Options (resolved
// against model.ApiSettings, packages/shared/domain/settings.ts's own apiSettingsSchema); the nil
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
	// bridge/http.go for an incognito tab (cookies.go). Never surfaced in Settings.
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


// normalize resolves every field to a concrete value, clamping to the same bounds
// packages/shared/domain/settings.ts's REQUEST_TIMEOUT_MS_RANGE/MAX_RESPONSE_MB_RANGE/
// MAX_REDIRECTS_RANGE state — a value out of range reaches here only via a hand-edited or
// pre-P90 stored tab row, never the dialog's own bounded inputs, so clamping (not rejecting) is
// what keeps a send working rather than failing on stale local state.
//
// Every default below must equal model.DefaultSettings().Api field for field — internal/storage/
// model/settings.go states the same coupling back at this file, since neither package may import
// the other.
func (o Options) normalize() resolved {
	r := resolved{
		http1:            false,
		timeout:          30 * time.Second,
		maxResponseBytes: 50 * 1024 * 1024,
		sslVerify:        true,
		followRedirects:  true,
		maxRedirects:     10,
		useJar:           false,
		ephemeral:        o.Ephemeral,
	}
	if o.HTTPVersion != nil {
		r.http1 = *o.HTTPVersion == "1.1"
	}
	if o.RequestTimeoutMs != nil {
		ms := min(max(*o.RequestTimeoutMs, 0), 3_600_000)
		if ms == 0 {
			r.timeout = 0
		} else {
			r.timeout = time.Duration(ms) * time.Millisecond
		}
	}
	if o.MaxResponseMb != nil {
		mb := min(max(*o.MaxResponseMb, 0), 2048)
		if mb == 0 {
			r.maxResponseBytes = 0
		} else {
			r.maxResponseBytes = int64(mb) * 1024 * 1024
		}
	}
	if o.SSLVerify != nil {
		r.sslVerify = *o.SSLVerify
	}
	if o.FollowRedirects != nil {
		r.followRedirects = *o.FollowRedirects
	}
	if o.MaxRedirects != nil {
		r.maxRedirects = min(max(*o.MaxRedirects, 0), 100)
	}
	if o.DisableCookieJar != nil {
		r.useJar = !*o.DisableCookieJar
	}
	return r
}

// transportKey is the only two fields of a send's resolved configuration that change how a
// *http.Transport itself is built — everything else (redirects, jar, timeout) varies per
// *http.Client instead, so connection reuse (sharedClient's whole reason to exist, D4) survives
// per-send Options.
type transportKey struct {
	http1      bool
	skipVerify bool
}

var (
	transportsMu sync.Mutex
	transports   = map[transportKey]*http.Transport{}
)

// transportFor returns the cached transport for k, building it once lazily — at most four ever
// exist (2 HTTP-version choices x 2 TLS-verify choices).
func transportFor(k transportKey) *http.Transport {
	transportsMu.Lock()
	defer transportsMu.Unlock()
	if tr, ok := transports[k]; ok {
		return tr
	}
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment}
	p := new(http.Protocols)
	p.SetHTTP1(true)
	if !k.http1 {
		p.SetHTTP2(true)
	}
	// SetUnencryptedHTTP2 stays off deliberately: HTTP/2 negotiates over ALPN on https:// only,
	// which is today's behaviour and what the setting means — do not "fix" this into h2c.
	tr.Protocols = p
	if k.skipVerify {
		// The only place in this app that turns certificate verification off. Reachable only from
		// an explicit per-request or global "SSL certificate verification: off", never a default,
		// and the request editor shows a warning chip while it is off (RequestSettingsPane.vue).
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}
	transports[k] = tr
	return tr
}

// checkRedirectFor is checkRedirect (client.go, pre-P90) closed over one send's resolved
// redirect policy — everything but the two branches below (the follow-redirects gate and the
// max-redirects bound, both newly variable per-send) is unchanged from before this phase, in the
// same order: closeHop, then the cross-host header-stripping block.
func checkRedirectFor(r resolved) func(*http.Request, []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if !r.followRedirects {
			// Before closeHop below: net/http returns the 3xx itself as the response when this
			// error is returned, so this hop is the *final* hop and finishFinal (client.go) is
			// what closes it — closing it here too, via closeHop, would record it twice.
			return http.ErrUseLastResponse
		}
		if len(via) >= r.maxRedirects {
			return fmt.Errorf("httpclient: stopped after %d redirects", r.maxRedirects)
		}
		if tl, _ := req.Context().Value(timelineCtxKey{}).(*timeline); tl != nil && req.Response != nil {
			// F13: the hop's own method, status text and headers are all readable here and nowhere
			// else; req is the next request about to be issued, so its method/URL address the hop
			// this call is opening (D9) before a single byte of it has gone out.
			tl.closeHop(req.Response, req.Method, req.URL.String())
		}

		// P21 round 3 finding 5: net/http's redirect machinery re-copies every header from the
		// *original* request onto each new hop (makeHeadersCopier closes over ireq, not the
		// previous hop's request), stripping only Authorization/WWW-Authenticate/Cookie/Cookie2
		// when the host changed from the original. A saved request's own custom headers —
		// X-Api-Key, PRIVATE-TOKEN, X-Amz-Security-Token and the like are at least as common in
		// this app's requests as Authorization — would otherwise silently follow a redirect to a
		// different host, replaying a secret to whatever answered the redirect. Drop every header
		// the user actually typed the moment a hop crosses hosts.
		//
		// F2: comparing only against the immediately-previous hop misses A -> B -> B — the second
		// hop is same-host relative to B, but the headers being carried were re-copied from the
		// *original* A request, so what matters is whether the current hop differs from the
		// original, not from the previous one. Since net/http always re-copies from the original,
		// comparing every hop against via[0] here is both correct and sufficient — no separate
		// "stay stripped once crossed" state needed.
		if len(via) > 0 {
			origin := via[0].URL
			crossHost := !sameRedirectHost(origin, req.URL)
			downgrade := isSchemeDowngrade(origin, req.URL)
			if crossHost || downgrade {
				if names, ok := req.Context().Value(redirectHeaderNamesCtxKey{}).([]string); ok {
					for _, name := range names {
						req.Header.Del(name)
					}
				}
			}
			if downgrade {
				// F3: an https -> http downgrade on the same host passes net/http's own
				// isDomainOrSubdomain check (it never looks at scheme), so Authorization and
				// Cookie survive onto the plaintext hop unless stripped here explicitly.
				req.Header.Del("Authorization")
				req.Header.Del("Cookie")
			}
		}
		return nil
	}
}
