package mobileweb

import (
	"net"
	"net/http"
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
