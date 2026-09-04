package httpclient

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// §6.3 case 1: a 301→302→200 chain — the body is the final one, Redirects has two hops with
// their real statuses and URLs, and FinalURL is the last.
func TestSend_RedirectChain(t *testing.T) {
	var serverURL string
	mux := http.NewServeMux()
	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, serverURL+"/mid", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/mid", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, serverURL+"/final", http.StatusFound)
	})
	mux.HandleFunc("/final", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("final-body"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	serverURL = srv.URL

	resp, err := Send(context.Background(), Request{Method: "GET", URL: srv.URL + "/start"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.Body != "final-body" {
		t.Fatalf("Body = %q, want %q", resp.Body, "final-body")
	}
	if resp.FinalURL != srv.URL+"/final" {
		t.Fatalf("FinalURL = %q, want %q", resp.FinalURL, srv.URL+"/final")
	}
	if len(resp.Redirects) != 2 {
		t.Fatalf("len(Redirects) = %d, want 2: %+v", len(resp.Redirects), resp.Redirects)
	}
	if resp.Redirects[0].Status != http.StatusMovedPermanently || resp.Redirects[0].URL != srv.URL+"/start" {
		t.Errorf("Redirects[0] = %+v, want {301 %s/start}", resp.Redirects[0], srv.URL)
	}
	if resp.Redirects[1].Status != http.StatusFound || resp.Redirects[1].URL != srv.URL+"/mid" {
		t.Errorf("Redirects[1] = %+v, want {302 %s/mid}", resp.Redirects[1], srv.URL)
	}
}

// §6.3 case 2: a response larger than the cap — BodyTruncated is true, BodyBytes reports what
// was read, and the reader is not left open.
func TestSend_BodySizeTruncation(t *testing.T) {
	oversized := bytes.Repeat([]byte("a"), maxResponseBytes+1000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(oversized)
	}))
	defer srv.Close()

	resp, err := Send(context.Background(), Request{Method: "GET", URL: srv.URL})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !resp.BodyTruncated {
		t.Fatal("BodyTruncated = false, want true")
	}
	if resp.BodyBytes != maxResponseBytes {
		t.Fatalf("BodyBytes = %d, want %d", resp.BodyBytes, maxResponseBytes)
	}
	if len(resp.Body) != maxResponseBytes {
		t.Fatalf("len(Body) = %d, want %d", len(resp.Body), maxResponseBytes)
	}
}

// §6.3 case 3: a body of invalid UTF-8 — BodyEncoding == "base64" and the bytes decode back
// byte-identical.
func TestSend_NonUTF8BodyBase64RoundTrip(t *testing.T) {
	raw := []byte{0xff, 0xfe, 0x00, 0x01, 'h', 'i', 0x80}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(raw)
	}))
	defer srv.Close()

	resp, err := Send(context.Background(), Request{Method: "GET", URL: srv.URL})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if resp.BodyEncoding != "base64" {
		t.Fatalf("BodyEncoding = %q, want base64", resp.BodyEncoding)
	}
	decoded, err := base64.StdEncoding.DecodeString(resp.Body)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	if !bytes.Equal(decoded, raw) {
		t.Fatalf("decoded = %v, want %v", decoded, raw)
	}
}

// §6.3 case 4: a server that never responds — the context deadline fires as E_TIMEOUT, and a
// cancelled context as E_CANCELLED. The two must not be conflated: one is a failure, one is the
// user.
func TestSend_TimeoutVsCancellation(t *testing.T) {
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-block
	}))
	// Registered after srv.Close() so defers run in the order that actually unblocks it (LIFO):
	// close(block) first, letting the handler goroutines return and their connections close,
	// then srv.Close() — the reverse order left Close() waiting up to its own hardcoded timeout
	// for connections whose handlers were still parked on a channel Close() itself was blocking.
	defer srv.Close()
	defer close(block)

	t.Run("timeout", func(t *testing.T) {
		old := defaultTimeout
		defaultTimeout = 50 * time.Millisecond
		defer func() { defaultTimeout = old }()

		_, err := Send(context.Background(), Request{Method: "GET", URL: srv.URL})
		code, ok := CodeOf(err)
		if !ok || code != CodeTimeout {
			t.Fatalf("CodeOf(err) = %v, %v, want %v, true (err: %v)", code, ok, CodeTimeout, err)
		}
	})

	t.Run("cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		go func() {
			time.Sleep(20 * time.Millisecond)
			cancel()
		}()
		_, err := Send(ctx, Request{Method: "GET", URL: srv.URL})
		code, ok := CodeOf(err)
		if !ok || code != CodeCancelled {
			t.Fatalf("CodeOf(err) = %v, %v, want %v, true (err: %v)", code, ok, CodeCancelled, err)
		}
	})
}

// §6.3 case 5: a user-supplied Host header actually reaches the server as the request's Host
// (F20a) — net/http silently drops Header.Set("Host", …) unless it is assigned to req.Host.
func TestSend_HostHeaderReachesServer(t *testing.T) {
	var gotHost string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
	}))
	defer srv.Close()

	_, err := Send(context.Background(), Request{
		Method:  "GET",
		URL:     srv.URL,
		Headers: []Header{{Name: "Host", Value: "example.internal"}},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotHost != "example.internal" {
		t.Fatalf("server saw Host = %q, want %q", gotHost, "example.internal")
	}
}
