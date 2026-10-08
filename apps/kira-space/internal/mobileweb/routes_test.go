package mobileweb

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// The route table is the whole API surface. This walks every method against every allowlisted and
// a set of tempting-but-forbidden paths: only the table's own pairs may reach a handler.
func TestRoutes_OnlyAllowlistedPairsReachHandlers(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	cookie := store.addDevice(t, "dev1")

	allowed := map[string]bool{}
	paths := map[string]bool{
		"/api/ade/backlog/add": true, "/api/ade/workflow-yaml": true, "/api/ade/refresh": true,
		"/api/ade/tasks": true, "/api/terminal": true, "/api/settings": true, "/api/ade/board/x": true,
	}
	for _, rt := range s.routes() {
		allowed[rt.method+" "+rt.path] = true
		paths[rt.path] = true
	}
	for path := range paths {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			rec := do(s, method, path, "127.0.0.1:50000", func(r *http.Request) {
				withCookie(cookie)(r)
				r.Header.Set("Origin", "https://127.0.0.1:7790")
				if path == "/api/events" {
					// A reachable SSE route would block; cancel at once.
					ctx, cancel := contextCanceled()
					defer cancel()
					*r = *r.WithContext(ctx)
				}
			})
			reached := rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed
			if reached != allowed[method+" "+path] {
				t.Errorf("%s %s: status %d, allowlisted=%v", method, path, rec.Code, allowed[method+" "+path])
			}
		}
	}
}

func TestRoutes_NoPostBesidesPair(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	for _, rt := range s.routes() {
		if rt.method != http.MethodGet && rt.path != "/api/pair" {
			t.Errorf("%s %s: the read-only server may expose only POST /api/pair as a non-GET", rt.method, rt.path)
		}
	}
}

func TestRoutes_ResponseHeaders(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	rec := do(s, http.MethodGet, "/api/ade/board", "127.0.0.1:50000", withCookie(store.addDevice(t, "dev1")))
	if rec.Code != http.StatusOK {
		t.Fatalf("board status %d: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store on /api", got)
	}
	for _, h := range []string{"Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"} {
		if rec.Header().Get(h) == "" {
			t.Errorf("missing security header %s", h)
		}
	}
	if !strings.Contains(rec.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Error("CSP must forbid framing")
	}
}

func TestRoutes_UnsafeMethodNeedsSameOrigin(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	for name, mut := range map[string]func(*http.Request){
		"no origin":      nil,
		"foreign origin": func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") },
		"http origin":    func(r *http.Request) { r.Header.Set("Origin", "http://127.0.0.1:7790") },
		"cross-site": func(r *http.Request) {
			r.Header.Set("Origin", "https://127.0.0.1:7790")
			r.Header.Set("Sec-Fetch-Site", "cross-site")
		},
	} {
		if rec := do(s, http.MethodPost, "/api/pair", "127.0.0.1:50000", mut); rec.Code != http.StatusForbidden {
			t.Errorf("%s: POST /api/pair status %d, want 403", name, rec.Code)
		}
	}
}

func TestStatic_ShellAndFallback(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	if rec := do(s, http.MethodGet, "/", "127.0.0.1:50000", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") {
		t.Errorf("index: %d %q", rec.Code, rec.Body)
	}
	nav := do(s, http.MethodGet, "/plan", "127.0.0.1:50000", func(r *http.Request) { r.Header.Set("Accept", "text/html") })
	if nav.Code != 200 || !strings.Contains(nav.Body.String(), "app") {
		t.Errorf("navigation fallback: %d", nav.Code)
	}
	if rec := do(s, http.MethodGet, "/missing.js", "127.0.0.1:50000", nil); rec.Code != 404 {
		t.Errorf("missing asset: %d, want 404", rec.Code)
	}
	if rec := do(s, http.MethodGet, "/assets/a.js", "127.0.0.1:50000", nil); !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Error("hashed assets must be immutable")
	}
	if rec := do(s, http.MethodGet, "/sw.js", "127.0.0.1:50000", nil); rec.Header().Get("Cache-Control") != "no-cache" {
		t.Error("service worker must revalidate")
	}
}

func TestRoutes_ConcurrentBoardReadsShareOneFetch(t *testing.T) {
	t.Parallel()
	s, store, reader := newTestServer(t)
	reader.gate = make(chan struct{})
	cookie := store.addDevice(t, "dev1")
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rec := do(s, http.MethodGet, "/api/ade/board", "127.0.0.1:50000", withCookie(cookie)); rec.Code != 200 {
				t.Errorf("board status %d", rec.Code)
			}
		}()
	}
	time.Sleep(100 * time.Millisecond)
	close(reader.gate)
	wg.Wait()
	reader.mu.Lock()
	defer reader.mu.Unlock()
	if reader.calls != 1 {
		t.Fatalf("5 concurrent reads made %d fetches, want 1", reader.calls)
	}
}
