package mobileweb

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
)

type liveServer struct {
	s       *Server
	store   *fakeStore
	client  *http.Client
	base    string
	origin  string
	changed chan struct{}
}

func startLive(t *testing.T) *liveServer {
	t.Helper()
	store, reader := newFakeStore(), &fakeReader{}
	port := freePort(t)
	changed := make(chan struct{}, 4)
	s := New(Config{
		Reader: reader, AgentSessions: func() any { return map[string]any{"sessions": []any{}} },
		Devices: store, Hub: NewHub(), Broker: NewBroker(time.Now), Assets: testAssets(),
		Port: port, Network: loopbackNet(),
		OnDevicesChanged: func() { changed <- struct{}{} },
	})
	s.isLAN = loopbackOK
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	client := &http.Client{Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)
	base := "http://127.0.0.1:" + portStr(port)
	return &liveServer{s: s, store: store, client: client, base: base, origin: base, changed: changed}
}

func (l *liveServer) pair(ctx context.Context) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, l.base+"/api/pair",
		strings.NewReader(`{"label":"Test phone","code":"4831"}`))
	req.Header.Set("Origin", l.origin)
	req.Header.Set("Content-Type", "application/json")
	return l.client.Do(req)
}

func (l *liveServer) waitPending(t *testing.T) string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if p := l.s.cfg.Broker.Pending().Pending; p != nil {
			return p.RequestID
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("pairing request never queued")
	return ""
}

func (l *liveServer) get(path, cookie string) (*http.Response, error) {
	req, _ := http.NewRequest(http.MethodGet, l.base+path, nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
	return l.client.Do(req)
}

func TestIntegration_PairReadStreamRevoke(t *testing.T) {
	l := startLive(t)

	type result struct {
		resp *http.Response
		err  error
	}
	pairDone := make(chan result, 1)
	go func() {
		resp, err := l.pair(context.Background()) //nolint:bodyclose // closed by the receiver below
		pairDone <- result{resp, err}
	}()
	pending := l.s.cfg.Broker.Pending
	reqID := l.waitPending(t)
	if m := pending().Pending.Meta; m.Code != "4831" || m.Label != "Test phone" || m.RemoteIP != "127.0.0.1" {
		t.Fatalf("approval prompt meta = %+v", m)
	}
	if l.store.count() != 0 {
		t.Fatal("no device row may exist before approval")
	}
	l.s.cfg.Broker.Approve(reqID)

	res := <-pairDone
	if res.err != nil {
		t.Fatal(res.err)
	}
	defer res.resp.Body.Close()
	if res.resp.StatusCode != 200 || l.store.count() != 1 {
		t.Fatalf("pair status %d, rows %d: the row must exist by the time the phone has its answer", res.resp.StatusCode, l.store.count())
	}
	var cookie *http.Cookie
	for _, c := range res.resp.Cookies() {
		if c.Name == cookieName {
			cookie = c
		}
	}
	if cookie == nil || cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
		t.Fatalf("device cookie missing or weak: %+v", cookie)
	}
	select {
	case <-l.changed:
	case <-time.After(time.Second):
		t.Fatal("device list change not announced")
	}

	board, err := l.get("/api/ade/board", cookie.Value)
	if err != nil {
		t.Fatal(err)
	}
	board.Body.Close()
	if board.StatusCode != 200 {
		t.Fatalf("board status %d", board.StatusCode)
	}

	stream, err := l.get("/api/events", cookie.Value) //nolint:bodyclose // closed by the defer below
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(stream.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	waitLine := func(want string) {
		t.Helper()
		timeout := time.After(2 * time.Second)
		for {
			select {
			case line, ok := <-lines:
				if !ok {
					t.Fatalf("stream ended before %q", want)
				}
				if strings.Contains(line, want) {
					return
				}
			case <-timeout:
				t.Fatalf("no %q on the stream", want)
			}
		}
	}
	waitLine("event: ready")
	l.s.cfg.Hub.Publish(adewire.ChannelBoard, nil)
	waitLine("event: " + adewire.ChannelBoard)

	if err := l.s.Revoke(cookieDeviceID(cookie.Value)); err != nil {
		t.Fatal(err)
	}
	select {
	case _, ok := <-lines:
		for ok {
			_, ok = <-lines
		}
	case <-time.After(2 * time.Second):
		t.Fatal("revoke must end the device's stream")
	}
	after, err := l.get("/api/ade/board", cookie.Value)
	if err != nil {
		t.Fatal(err)
	}
	after.Body.Close()
	if after.StatusCode != 401 {
		t.Fatalf("revoked device status %d, want 401", after.StatusCode)
	}
}

func cookieDeviceID(v string) string { id, _, _ := strings.Cut(v, "."); return id }

func TestIntegration_PairCancelledWhenPhoneDisconnects(t *testing.T) {
	l := startLive(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if resp, err := l.pair(ctx); err == nil {
			resp.Body.Close()
		}
	}()
	l.waitPending(t)
	cancel()
	<-done
	deadline := time.Now().Add(2 * time.Second)
	for l.s.cfg.Broker.Pending().Pending != nil {
		if time.Now().After(deadline) {
			t.Fatal("a request whose phone went away must leave the queue")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestIntegration_CloseReleasesParkedPairing(t *testing.T) {
	l := startLive(t)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if resp, err := l.pair(context.Background()); err == nil {
			resp.Body.Close()
		}
	}()
	l.waitPending(t)
	closed := make(chan struct{})
	go func() { _ = l.s.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(4 * time.Second):
		t.Fatal("Close must not wait out the approval window")
	}
	wg.Wait()
	if l.s.cfg.Broker.Pending().Pending != nil {
		t.Fatal("parked request must leave the queue on close")
	}
}
