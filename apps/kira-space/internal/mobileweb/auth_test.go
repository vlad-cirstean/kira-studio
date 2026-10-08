package mobileweb

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestAuth_Verdicts(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	good := store.addDevice(t, "dev1")
	id, tok, _ := strings.Cut(good, ".")
	revoked := store.addDevice(t, "dev2")
	if err := store.Revoke("dev2", 1); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name   string
		cookie string
		status int
		code   string
	}{
		{"valid", good, 200, ""},
		{"no credential", "", 401, codeUnauthorized},
		{"wrong token", id + ".wrong" + tok[5:], 401, codeUnauthorized},
		{"unknown device", "nobody." + tok, 401, codeUnauthorized},
		{"revoked", revoked, 401, codeRevoked},
	}
	for _, c := range cases {
		var mut func(*http.Request)
		if c.cookie != "" {
			mut = withCookie(c.cookie)
		}
		rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:50000", mut)
		if rec.Code != c.status || (c.code != "" && !strings.Contains(rec.Body.String(), c.code)) {
			t.Errorf("%s: status %d body %s", c.name, rec.Code, rec.Body)
		}
		if c.code != "" && c.code != codeUnauthorized || c.name == "wrong token" || c.name == "unknown device" {
			if !strings.Contains(rec.Header().Get("Set-Cookie"), "Max-Age=0") {
				t.Errorf("%s: a rejected credential must be cleared", c.name)
			}
		}
	}
}

func TestAuth_StoreErrorIsNotARevoke(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	cookie := store.addDevice(t, "dev1")
	store.lookErr = errors.New("database is locked")
	rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:50000", withCookie(cookie))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", rec.Code)
	}
	if strings.Contains(rec.Header().Get("Set-Cookie"), cookieName) {
		t.Fatal("a store failure must not clear the phone's credential")
	}
}

func TestAuth_FailedGuessesAreRateLimited(t *testing.T) {
	t.Parallel()
	s, store, _ := newTestServer(t)
	good := store.addDevice(t, "dev1")
	for i := 0; i < 10; i++ {
		if rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:50000", withCookie("dev1.bad")); rec.Code != 401 {
			t.Fatalf("guess %d: status %d", i, rec.Code)
		}
	}
	if rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:50000", withCookie(good)); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after 10 failures even a valid cookie from that IP gets %d, want 429", rec.Code)
	}
	if rec := do(s, http.MethodGet, "/api/me", "127.0.0.2:50000", withCookie(good)); rec.Code != 200 {
		t.Fatalf("another IP must be unaffected, got %d", rec.Code)
	}
}

func TestAuth_UnpairedLoadsDoNotBurnTheFailureBudget(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	for i := 0; i < 30; i++ {
		if rec := do(s, http.MethodGet, "/api/me", "127.0.0.1:50000", nil); rec.Code != 401 {
			t.Fatalf("load %d: status %d", i, rec.Code)
		}
	}
}
