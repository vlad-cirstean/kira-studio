// Package httpclient is the whole outbound HTTP path for P2's request builder: one exported
// Send(ctx, Request) (Response, error), self-contained and dependency-free (no adapters,
// adapterhost, storage or Wails import — drivable from a plain httptest server, C2's own proof).
// Every default it takes on the caller's behalf is named and explained below (D4); nothing here
// silently rewrites what the user asked for.
package httpclient

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
)

// defaultTimeout applies via context.WithTimeout on the caller's ctx, never http.Client.Timeout —
// one mechanism for both timeout and cancel, so both abort an in-progress body read too. A var,
// not a const, so client_test.go can shrink it around the two cases that need a fast deadline.
var defaultTimeout = 30 * time.Second

// maxRedirects — Postman's own default follow-and-record shape (D4): the redirect chain and every
// hop's status/URL both end up in Response, so a 301 never silently renders as a 200 from a
// different origin.
const maxRedirects = 10

// maxResponseBytes — 10 MiB. A response body larger than this is truncated, not refused; the
// truncation is reported (Response.BodyTruncated), never hidden.
const maxResponseBytes = 10 * 1024 * 1024

// sharedClient — one package-level *http.Client over one *http.Transport, for connection reuse
// across sends to the same host (D4). TLS verification is always on: TLSClientConfig is left nil,
// so the transport's own secure default (InsecureSkipVerify: false) applies with no per-request
// opt-out (P2 has nowhere to put one, §8 OQ-4). Jar stays nil — no cookie replay (§0.2).
var sharedClient = &http.Client{
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	},
	CheckRedirect: checkRedirect,
}

var validMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true,
	"OPTIONS": true,
}

// Header is one request or response header. Response headers come back sorted by name, one entry
// per value so duplicates survive — F19's honest substitute for net/http's order-losing,
// key-canonicalising map; there is no stdlib access to the bytes as received.
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Request is the wire shape control.ts's httpSend sends. Headers/body/method go out unmodified —
// P2's one design requirement (D1): no client library sits between this struct and the wire.
type Request struct {
	Method  string   `json:"method"`
	URL     string   `json:"url"`
	Headers []Header `json:"headers"`
	Body    string   `json:"body"`
	HasBody bool     `json:"hasBody"`
}

// RedirectHop is one followed redirect: the status that was returned, and the URL that returned
// it (not the URL it redirected to — that is either the next hop's URL, or FinalURL for the last
// one).
type RedirectHop struct {
	Status int    `json:"status"`
	URL    string `json:"url"`
}

// Response is the wire shape Send returns. Body's meaning depends on BodyEncoding: "utf8" is the
// bytes as a string, "base64" is the raw bytes — Go's encoding/json would otherwise replace
// invalid UTF-8 with U+FFFD and silently corrupt a binary response (D4).
type Response struct {
	Status        int           `json:"status"`
	StatusText    string        `json:"statusText"`
	Proto         string        `json:"proto"`
	Headers       []Header      `json:"headers"`
	Body          string        `json:"body"`
	BodyEncoding  string        `json:"bodyEncoding"` // "utf8" | "base64"
	BodyBytes     int           `json:"bodyBytes"`
	BodyTruncated bool          `json:"bodyTruncated"`
	ElapsedMs     int           `json:"elapsedMs"`
	FinalURL      string        `json:"finalUrl"`
	Redirects     []RedirectHop `json:"redirects"`
}

type redirectsCtxKey struct{}

// checkRedirect is sharedClient's CheckRedirect: net/http sets req.Response to the redirect
// response before invoking this (net/http/client.go's do()), so the status of each hop is
// available here even though CheckRedirect's own signature carries only requests. Each call's own
// []RedirectHop is threaded through via a context value rather than a package-level field, since
// sharedClient is shared across concurrent Send calls.
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

// hasScheme reports whether s already begins with "<scheme>://" — deliberately stricter than
// url.Parse's own Scheme field, which never populates for a bare "api.example.com/path" (no
// "//") in the first place, so resolveURL has to know to prepend one before parsing at all.
func hasScheme(s string) bool {
	i := strings.Index(s, "://")
	if i <= 0 {
		return false
	}
	for _, c := range s[:i] {
		if !(c == '+' || c == '-' || c == '.' ||
			(c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

// resolveURL applies D4's scheme default (a URL with no scheme resolves to https://, fails safe
// rather than quietly going out in the clear) and refuses everything E_BAD_REQUEST should refuse
// before a single byte goes out.
func resolveURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, newError(CodeBadRequest, "URL is required", nil)
	}
	if !hasScheme(trimmed) {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, newError(CodeBadRequest, "invalid URL: "+err.Error(), err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, newError(CodeBadRequest, "unsupported URL scheme: "+u.Scheme, nil)
	}
	if u.Host == "" {
		return nil, newError(CodeBadRequest, "URL has no host", nil)
	}
	return u, nil
}

// classifySendErr distinguishes a timeout from a cancellation (F20/D8's own point: one is a
// failure, the other is the user) by reading sendCtx.Err() rather than the wrapped error itself —
// net/http wraps a context error inside a *url.Error, and this way there is exactly one place
// that has to know that.
func classifySendErr(sendCtx context.Context, err error) *Error {
	if sendCtx.Err() != nil {
		if sendCtx.Err() == context.DeadlineExceeded {
			return newError(CodeTimeout, "request timed out", err)
		}
		return newError(CodeCancelled, "request was cancelled", err)
	}
	return newError(CodeHTTPTransport, err.Error(), err)
}

func flattenHeaders(h http.Header) []Header {
	keys := make([]string, 0, len(h))
	for k := range h {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	headers := make([]Header, 0, len(h))
	for _, k := range keys {
		for _, v := range h[k] {
			headers = append(headers, Header{Name: k, Value: v})
		}
	}
	return headers
}

func statusText(status string) string {
	if i := strings.IndexByte(status, ' '); i >= 0 {
		return status[i+1:]
	}
	return ""
}

// Send issues exactly one HTTP request and returns exactly one response — no retry, no second
// request, no rewriting of what the caller asked for. Both request send and body read happen
// under one deadline (defaultTimeout, layered onto ctx so the Stop button and the window-close
// abort both reach a body read in progress too).
func Send(ctx context.Context, req Request) (Response, error) {
	if !validMethods[req.Method] {
		return Response{}, newError(CodeBadRequest, "unsupported method: "+req.Method, nil)
	}
	u, err := resolveURL(req.URL)
	if err != nil {
		return Response{}, err
	}

	sendCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()
	hops := &[]RedirectHop{}
	sendCtx = context.WithValue(sendCtx, redirectsCtxKey{}, hops)

	var body io.Reader
	if req.HasBody {
		body = strings.NewReader(req.Body)
	}

	httpReq, err := http.NewRequestWithContext(sendCtx, req.Method, u.String(), body)
	if err != nil {
		return Response{}, newError(CodeBadRequest, "could not build request: "+err.Error(), err)
	}

	// F20a: net/http silently ignores Header.Set("Host", …) — it writes req.Host/req.URL.Host
	// instead, so a user-typed Host: header must be assigned there explicitly or it does nothing.
	hasUserAgent := false
	for _, h := range req.Headers {
		if strings.EqualFold(h.Name, "Host") {
			httpReq.Host = h.Value
			continue
		}
		if strings.EqualFold(h.Name, "User-Agent") {
			hasUserAgent = true
		}
		httpReq.Header.Add(h.Name, h.Value)
	}
	if !hasUserAgent {
		// Go's default "Go-http-client/1.1" misrepresents the app; overridable by the user (D4).
		httpReq.Header.Set("User-Agent", "Kira Studio/"+buildinfo.Version)
	}
	// F20b: the transport auto-adds Accept-Encoding: gzip and transparently decompresses only
	// when the caller didn't set that header itself. We never set it here, so a user-supplied
	// Accept-Encoding above is passed through untouched and the response is reported as-received
	// — no explicit "detect and skip decoding" branch is needed on top of that default.

	start := time.Now()
	resp, err := sharedClient.Do(httpReq)
	if err != nil {
		return Response{}, classifySendErr(sendCtx, err)
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, maxResponseBytes+1)
	data, readErr := io.ReadAll(limited)
	if readErr != nil {
		return Response{}, classifySendErr(sendCtx, readErr)
	}
	truncated := false
	if len(data) > maxResponseBytes {
		data = data[:maxResponseBytes]
		truncated = true
	}
	elapsed := time.Since(start)

	encoding := "utf8"
	bodyStr := string(data)
	if !utf8.Valid(data) {
		encoding = "base64"
		bodyStr = base64.StdEncoding.EncodeToString(data)
	}

	finalURL := u.String()
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}

	return Response{
		Status:        resp.StatusCode,
		StatusText:    statusText(resp.Status),
		Proto:         resp.Proto,
		Headers:       flattenHeaders(resp.Header),
		Body:          bodyStr,
		BodyEncoding:  encoding,
		BodyBytes:     len(data),
		BodyTruncated: truncated,
		ElapsedMs:     int(elapsed.Milliseconds()),
		FinalURL:      finalURL,
		Redirects:     *hops,
	}, nil
}
