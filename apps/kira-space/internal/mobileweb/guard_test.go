package mobileweb

import (
	"encoding/json"
	"github.com/google/uuid"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGuard_RemoteAndHost(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	cookie := store.addDevice(t, "dev1")
	s.mdns = "mac.local"
	hostReq := func(host string) func(*http.Request) {
		return func(r *http.Request) { r.Host = host; withCookie(cookie)(r) }
	}
	for remote, want := range map[string]int{
		"127.0.0.1:1": 200, "192.168.1.9:1": 200, "10.1.2.3:1": 200, "172.20.0.4:1": 200,
		"8.8.8.8:1": 403, "100.64.0.1:1": 403, "[::1]:1": 403, "[2001:db8::1]:1": 403,
	} {
		if rec := do(s, http.MethodGet, "/api/me", remote, hostReq("127.0.0.1:7790")); rec.Code != want {
			t.Errorf("remote %s: status %d, want %d", remote, rec.Code, want)
		}
	}
	for host, want := range map[string]int{
		"127.0.0.1:7790": 200, "localhost:7790": 200, "mac.local:7790": 200, "MAC.LOCAL:7790": 200,
		"evil.example:7790": 403, "10.9.9.9:7790": 403, "": 403,
	} {
		if rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:1", hostReq(host)); rec.Code != want {
			t.Errorf("host %q: status %d, want %d", host, rec.Code, want)
		}
	}
}

func TestHostAllowed_UsesBoundSet(t *testing.T) {
	t.Parallel()
	bound := []net.IP{net.ParseIP("192.168.1.5")}
	if !hostAllowed("192.168.1.5:7790", bound, "") || hostAllowed("192.168.1.6:7790", bound, "") {
		t.Fatal("only bound addresses are valid IP hosts")
	}
}

const idemA = "8f14e45f-ceea-467a-9575-1f1e1d3a4b21"

func postJSON(s *Server, path, cookie, key, body string, mutate ...func(*http.Request)) *httptest.ResponseRecorder {
	return doBody(s, http.MethodPost, path, "127.0.0.1:50000", body, func(r *http.Request) {
		withCookie(cookie)(r)
		r.Header.Set("Origin", "https://127.0.0.1:7790")
		if key != "" {
			r.Header.Set(idemKeyHeader, key)
		}
		for _, m := range mutate {
			m(r)
		}
	})
}

func errCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("body %q: %v", rec.Body, err)
	}
	return b.Code
}

func TestWrite_RefusedWithoutOriginPermissionOrKey(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	writer := s.cfg.Writer.(*fakeWriter)
	cookie := store.addDeviceWith(t, "dev1", true, false)
	body := `{"text":"x"}`

	noOrigin := doBody(s, http.MethodPost, "/api/ade/backlog/items", "127.0.0.1:50000", body, func(r *http.Request) {
		withCookie(cookie)(r)
		r.Header.Set(idemKeyHeader, idemA)
	})
	if noOrigin.Code != http.StatusForbidden {
		t.Errorf("no Origin: %d, want 403", noOrigin.Code)
	}
	if rec := postJSON(s, "/api/ade/backlog/items", store.addDevice(t, "dev2"), idemA, body); rec.Code != http.StatusForbidden || errCode(t, rec) != codeWriteOff {
		t.Errorf("device without can_write: %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(s, "/api/ade/backlog/items", cookie, "", body); rec.Code != http.StatusBadRequest || errCode(t, rec) != "E_IDEMPOTENCY_KEY" {
		t.Errorf("missing key: %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(s, "/api/ade/backlog/items", cookie, "not-a-uuid", body); rec.Code != http.StatusBadRequest {
		t.Errorf("bad key: %d", rec.Code)
	}
	if rec := postJSON(s, "/api/agent/sessions/s1/send", cookie, idemA, `{"message":"hi"}`); rec.Code != http.StatusForbidden || errCode(t, rec) != codeAgentInputOff {
		t.Errorf("write device without agent input: %d %s", rec.Code, rec.Body)
	}
	if writer.count() != 0 {
		t.Errorf("a refused write reached the service %d times", writer.count())
	}
}

func TestWrite_AgentInputNeedsGlobalSwitch(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	cookie := store.addDeviceWith(t, "dev1", true, true)
	send := func() *httptest.ResponseRecorder {
		return postJSON(s, "/api/agent/sessions/s1/send", cookie, uuid.NewString(), `{"message":"hi"}`)
	}
	if rec := send(); rec.Code != http.StatusOK {
		t.Fatalf("both switches on: %d %s", rec.Code, rec.Body)
	}
	s.cfg.AgentInputEnabled = func() bool { return false }
	if rec := send(); rec.Code != http.StatusForbidden || errCode(t, rec) != codeAgentInputOff {
		t.Errorf("global off: %d %s", rec.Code, rec.Body)
	}
}

func TestWrite_TerminalHandshakeNeedsSameOrigin(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	cookie := store.addDeviceWith(t, "dev1", true, true)
	attach := func(origin string) int {
		return do(s, http.MethodGet, "/api/agent/sessions/s1/terminal", "127.0.0.1:50000", func(r *http.Request) {
			withCookie(cookie)(r)
			if origin != "" {
				r.Header.Set("Origin", origin)
			}
		}).Code
	}
	if got := attach("https://evil.example"); got != http.StatusForbidden {
		t.Errorf("foreign Origin: %d, want 403", got)
	}
	if got := attach(""); got != http.StatusForbidden {
		t.Errorf("no Origin: %d, want 403", got)
	}
	if got := attach("https://127.0.0.1:7790"); got != http.StatusNoContent {
		t.Errorf("same Origin reaches the broker: %d", got)
	}
}
