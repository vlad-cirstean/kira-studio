package httpclient

import (
	"bytes"
	"context"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// buildTestRequest mirrors client.go's Send: the header loop (including F20a's Host special case),
// the User-Agent default and D7's Content-Type precedence — the exact construction wire_test.go's
// own exactness case (below) needs to hold still while it renders and then really sends the same
// *http.Request. Deliberately separate from body_test.go's own sendViaBuildBody, which sends
// immediately and never needs the Host case or a chance to render first.
func buildTestRequest(t *testing.T, rawURL, method string, headers []Header, b Body) (*http.Request, string) {
	t.Helper()
	userContentType, hasUserCT := headerValue(headers, "Content-Type")
	formBoundary := ""
	if b.Mode == string(BodyFormData) {
		if hasUserCT {
			if mt, params, err := mime.ParseMediaType(userContentType); err == nil && mt == "multipart/form-data" {
				formBoundary = params["boundary"]
			}
		}
		if formBoundary == "" {
			formBoundary = mintBoundary()
		}
	}
	body, getBody, length, defaultContentType, err := buildBody(b, formBoundary)
	if err != nil {
		t.Fatalf("buildBody: %v", err)
	}
	req, err := http.NewRequest(method, rawURL, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if body != nil {
		req.Body = body
		req.GetBody = getBody
		req.ContentLength = length
	}
	hasUserAgent := false
	for _, h := range headers {
		if strings.EqualFold(h.Name, "Host") {
			req.Host = h.Value
			continue
		}
		if strings.EqualFold(h.Name, "User-Agent") {
			hasUserAgent = true
		}
		req.Header.Add(h.Name, h.Value)
	}
	if !hasUserAgent {
		req.Header.Set("User-Agent", "Kira Studio/test")
	}
	switch {
	case !hasUserCT:
		if defaultContentType != "" {
			req.Header.Set("Content-Type", defaultContentType)
		}
	case b.Mode == string(BodyFormData):
		if mt, params, err := mime.ParseMediaType(userContentType); err == nil && mt == "multipart/form-data" {
			if _, ok := params["boundary"]; !ok {
				req.Header.Set("Content-Type", userContentType+"; boundary="+formBoundary)
			}
		}
	}
	return req, formBoundary
}

// teeConn tees every byte written to it into buf before writing on — F6/F7's own probe technique,
// used only inside this test (§0.2: this phase never installs a tee in shipped code).
type teeConn struct {
	net.Conn
	buf *bytes.Buffer
}

func (c *teeConn) Write(p []byte) (int, error) {
	c.buf.Write(p)
	return c.Conn.Write(p)
}

// §6.2 case 1 — the single most valuable test in the phase (its own comment in the plan): a future
// Go release changing Request.write is exactly what would break this feature silently, so this
// pins F7/F14 as a regression test rather than a one-off measurement. One *http.Request is (a)
// rendered via renderRequest, then (b) actually sent through a teed dialer to a real httptest
// server — DumpRequestOut restores req.Body after dumping (net/http/httputil's own contract), so
// the same request object can be sent for real immediately after. The two captures must be
// byte-identical.
func TestRenderRequest_ExactnessAgainstTheWire(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	headers := []Header{
		{Name: "Alpha", Value: "a"},
		{Name: "Host", Value: "internal.example"},
		{Name: "X-Multi", Value: "one"},
		{Name: "X-Multi", Value: "two"},
		{Name: "Zeta", Value: "z"},
		{Name: "Accept-Encoding", Value: "identity"},
	}
	body := Body{Mode: string(BodyCode), Code: `{"a":1}`, CodeLanguage: "json"}
	req, formBoundary := buildTestRequest(t, srv.URL+"/v2/orders?a=1&b=2", "POST", headers, body)

	rendered, _, err := renderRequest(req, body, formBoundary)
	if err != nil {
		t.Fatalf("renderRequest: %v", err)
	}

	var captured bytes.Buffer
	dialer := &net.Dialer{}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, dialErr := dialer.DialContext(ctx, network, addr)
			if dialErr != nil {
				return nil, dialErr
			}
			return &teeConn{Conn: conn, buf: &captured}, nil
		},
	}
	client := &http.Client{Transport: transport}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v", err)
	}
	_ = resp.Body.Close()

	if rendered != captured.String() {
		t.Fatalf("renderRequest did not match the real wire bytes:\nrendered:\n%q\nwire:\n%q", rendered, captured.String())
	}
	// F7's own headline claims, checked directly rather than only through the byte-for-byte
	// equality above — a future refactor that broke the comparison itself would still fail here.
	if !strings.Contains(rendered, "Host: internal.example\r\n") {
		t.Errorf("rendered request did not honour the Host: override (F14):\n%s", rendered)
	}
	if !strings.Contains(rendered, "X-Multi: one\r\nX-Multi: two\r\n") &&
		!strings.Contains(rendered, "X-Multi: one\r\n") {
		t.Errorf("rendered request lost the duplicate X-Multi header:\n%s", rendered)
	}
	if strings.Count(rendered, "X-Multi:") != 2 {
		t.Errorf("rendered request has %d X-Multi lines, want 2:\n%s", strings.Count(rendered, "X-Multi:"), rendered)
	}
	if strings.Contains(rendered, "Accept-Encoding: gzip") {
		t.Errorf("rendered request added gzip over the caller's own Accept-Encoding: identity:\n%s", rendered)
	}
}

// §6.2 case 2: a two-text-part, one-file-part formdata body renders the exact boundary and part
// headers multipartLength counted, the file payload replaced by its marker (never read from disk),
// and — critically — the head's own Content-Length is always the real dry-run count (D4), even
// though the rendered body region is shorter than that because the marker stands in for the file.
func TestRenderRequest_MultipartElision(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "report.csv")
	content := bytes.Repeat([]byte("x"), 4096)
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	fields := []FormField{
		{Name: "title", Kind: "text", Value: "hello"},
		{Name: "note", Kind: "text", Value: "world"},
		{Name: "file", Kind: "file", Path: filePath},
	}
	body := Body{Mode: string(BodyFormData), FormData: fields}
	req, formBoundary := buildTestRequest(t, "http://example.invalid/upload", "POST", nil, body)

	text, elided, err := renderRequest(req, body, formBoundary)
	if err != nil {
		t.Fatalf("renderRequest: %v", err)
	}
	if !elided {
		t.Fatal("elided = false, want true")
	}
	marker := fmt.Sprintf("[… %d bytes of report.csv …]", len(content))
	if !strings.Contains(text, marker) {
		t.Fatalf("text does not contain %q:\n%s", marker, text)
	}
	if strings.Contains(text, string(content[:100])) {
		t.Fatal("text contains the file's real bytes — the payload should be elided, never read")
	}
	if !strings.Contains(text, `name="title"`) || !strings.Contains(text, "hello") {
		t.Fatalf("text is missing the first text part verbatim:\n%s", text)
	}
	if !strings.Contains(text, `name="note"`) || !strings.Contains(text, "world") {
		t.Fatalf("text is missing the second text part verbatim:\n%s", text)
	}
	wantContentLength := fmt.Sprintf("Content-Length: %d\r\n", req.ContentLength)
	if !strings.Contains(text, wantContentLength) {
		t.Fatalf("text does not report the real Content-Length %q:\n%s", wantContentLength, text)
	}
}

// §6.2 case 3: a 300 KiB raw body renders 128 KiB plus the marker, and the head still reports the
// real 300 KiB length — the elision never lies about size (D4).
func TestRenderRequest_128KiBCap(t *testing.T) {
	raw := strings.Repeat("a", 300*1024)
	body := Body{Mode: string(BodyRaw), Raw: raw}
	req, formBoundary := buildTestRequest(t, "http://example.invalid/paste", "POST", nil, body)

	text, elided, err := renderRequest(req, body, formBoundary)
	if err != nil {
		t.Fatalf("renderRequest: %v", err)
	}
	if !elided {
		t.Fatal("elided = false, want true")
	}
	if !strings.Contains(text, strings.Repeat("a", maxWireBodyBytes)) {
		t.Fatal("text does not contain the first 128 KiB verbatim")
	}
	wantMarker := fmt.Sprintf("[… %d more bytes …]", len(raw)-maxWireBodyBytes)
	if !strings.Contains(text, wantMarker) {
		t.Fatalf("text does not contain %q", wantMarker)
	}
	wantContentLength := fmt.Sprintf("Content-Length: %d\r\n", len(raw))
	if !strings.Contains(text, wantContentLength) {
		t.Fatalf("text does not report the real 300 KiB Content-Length %q:\n%s", wantContentLength, text[:200])
	}
}

// §6.2 case 4: a `file` body renders the head plus one marker and reads no file bytes at all —
// renderRequestBody's BodyFile case never opens the file, only uses the size Send already resolved
// (httpReq.ContentLength) and the file's base name.
func TestRenderRequestBody_FileBodyReadsNoBytes(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "report.pdf")
	content := []byte("%PDF-1.4 this content must never appear in the rendering")
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	text, elided, err := renderRequestBody(Body{Mode: string(BodyFile), File: filePath}, "", int64(len(content)))
	if err != nil {
		t.Fatalf("renderRequestBody: %v", err)
	}
	if !elided {
		t.Fatal("elided = false, want true")
	}
	want := fmt.Sprintf("[… %d bytes of report.pdf …]", len(content))
	if text != want {
		t.Fatalf("text = %q, want %q", text, want)
	}
}

// §6.2 case 5: fidelity classification — proto 1.1 + no proxy → exact; proto 2.0 → http2 regardless
// of proxy; proto 1.1 + a proxy function returning a URL → proxied.
func TestClassifyFidelity(t *testing.T) {
	req, err := http.NewRequest("GET", "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	old := wireProxyFunc
	defer func() { wireProxyFunc = old }()

	t.Run("exact", func(t *testing.T) {
		wireProxyFunc = func(*http.Request) (*url.URL, error) { return nil, nil }
		if got := classifyFidelity(&http.Response{ProtoMajor: 1}, req); got != "exact" {
			t.Fatalf("classifyFidelity = %q, want exact", got)
		}
	})
	t.Run("http2", func(t *testing.T) {
		wireProxyFunc = func(*http.Request) (*url.URL, error) { return nil, nil }
		if got := classifyFidelity(&http.Response{ProtoMajor: 2}, req); got != "http2" {
			t.Fatalf("classifyFidelity = %q, want http2", got)
		}
	})
	t.Run("proxied", func(t *testing.T) {
		wireProxyFunc = func(*http.Request) (*url.URL, error) {
			return url.Parse("http://proxy.internal:8080")
		}
		if got := classifyFidelity(&http.Response{ProtoMajor: 1}, req); got != "proxied" {
			t.Fatalf("classifyFidelity = %q, want proxied", got)
		}
	})
}

// §6.2 case 6: a base64 (binary) response body never leaks into WireExchange.ResponseHead — D5's
// "it does not include the body" rule, checked against a real send rather than only asserted. The
// marker RawExchangePane.vue shows for a binary body is the frontend's own concatenation (D5); Go's
// only obligation is to never carry the raw bytes here.
func TestSend_WireResponseHeadNeverCarriesTheBinaryBody(t *testing.T) {
	raw := []byte{0xff, 0xfe, 0x00, 0x01, 'h', 'i', 0x80}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test", "v")
		_, _ = w.Write(raw)
	}))
	defer srv.Close()

	resp, err := Send(context.Background(), Request{Method: "GET", URL: srv.URL})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.BodyEncoding != "base64" {
		t.Fatalf("BodyEncoding = %q, want base64 (test setup assumption)", resp.BodyEncoding)
	}
	if resp.Wire == nil {
		t.Fatal("Wire is nil")
	}
	if strings.Contains(resp.Wire.ResponseHead, string(raw)) {
		t.Fatal("ResponseHead leaked the binary response body")
	}
	if !strings.Contains(resp.Wire.ResponseHead, "X-Test: v") {
		t.Fatalf("ResponseHead is missing a real header:\n%s", resp.Wire.ResponseHead)
	}
	if !utf8.ValidString(resp.Wire.ResponseHead) {
		t.Fatal("ResponseHead is not valid text — the binary body leaked into it")
	}
}
