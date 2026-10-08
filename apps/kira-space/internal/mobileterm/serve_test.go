package mobileterm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// dial returns the handshake status alongside the connection; the response body is closed here.
func dial(t *testing.T, srv *httptest.Server, query string) (*websocket.Conn, int, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	ws, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/?"+query, nil)
	status := 0
	if resp != nil {
		status = resp.StatusCode
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
	}
	return ws, status, err
}

func readCtrl(t *testing.T, ws *websocket.Conn) ctrlFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, data, err := ws.Read(ctx)
	if err != nil || typ != websocket.MessageText {
		t.Fatalf("control frame: %v %v", typ, err)
	}
	var f ctrlFrame
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestServe_ReplayInputAndReclaim(t *testing.T) {
	b, reg, _ := newTestBroker(t)
	b.Output("t-s1", []byte("hello "))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b.Serve(w, r, phoneA, "s1", nil)
	}))
	defer srv.Close()

	ws, _, err := dial(t, srv, "cols=50&rows=20")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if f := readCtrl(t, ws); f.Type != "hello" || *f.Offset != 0 {
		t.Fatalf("hello = %+v", f)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := ws.Read(ctx)
	if err != nil || string(data) != "hello " {
		t.Fatalf("replay = %q %v", data, err)
	}

	b.Output("t-s1", []byte("live"))
	if _, data, err = ws.Read(ctx); err != nil || string(data) != "live" {
		t.Fatalf("tail = %q %v", data, err)
	}
	if err := ws.Write(ctx, websocket.MessageBinary, []byte("ls\r")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		reg.mu.Lock()
		n := len(reg.writes)
		reg.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("input never reached the PTY")
		}
		time.Sleep(10 * time.Millisecond)
	}

	b.Reclaim("t-s1", 0, 0)
	if _, _, err = ws.Read(ctx); websocket.CloseStatus(err) != CloseReclaimed {
		t.Fatalf("close = %v", err)
	}
}

func TestServe_ResumeAndBadRequest(t *testing.T) {
	b, _, _ := newTestBroker(t)
	b.Output("t-s1", []byte("abcdef"))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b.Serve(w, r, phoneA, "s1", nil)
	}))
	defer srv.Close()

	if _, status, err := dial(t, srv, "cols=0&rows=20"); err == nil || status != http.StatusBadRequest {
		t.Fatalf("bad dims: %v", err)
	}
	ws, _, err := dial(t, srv, "cols=50&rows=20&from=4")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if f := readCtrl(t, ws); *f.Offset != 4 || f.Reset {
		t.Fatalf("hello = %+v", f)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, data, _ := ws.Read(ctx); string(data) != "ef" {
		t.Fatalf("resume = %q", data)
	}
}
