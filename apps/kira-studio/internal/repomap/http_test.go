package repomap

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAuthRejectsMissingOrWrongToken is §11's own item 3: a request carrying no valid bearer token
// must never reach a tool handler — proven at the HTTP layer, below the mcp.Server entirely, so a
// bug here can't hide behind a mock that skips real request routing. srv.http.Handler is the exact
// mux Serve would run; this test never binds a socket, it drives the handler directly.
func TestAuthRejectsMissingOrWrongToken(t *testing.T) {
	srv := newConformanceServer(t)

	cases := []struct {
		name   string
		header string
	}{
		{"no header", ""},
		{"wrong token", "Bearer not-the-real-token"},
		{"malformed header", "not-even-bearer-shaped"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, mcpPath, nil)
			if c.header != "" {
				req.Header.Set("Authorization", c.header)
			}
			rec := httptest.NewRecorder()
			srv.http.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d (Unauthorized)", rec.Code, http.StatusUnauthorized)
			}
		})
	}

	t.Run("correct token reaches past auth", func(t *testing.T) {
		plain, _ := srv.Token()
		if plain == "" {
			t.Fatal("test setup: server has no plaintext token to present")
		}
		req := httptest.NewRequest(http.MethodPost, mcpPath, nil)
		req.Header.Set("Authorization", "Bearer "+plain)
		rec := httptest.NewRecorder()
		srv.http.Handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusUnauthorized {
			t.Fatalf("status = %d, want anything other than Unauthorized once past a valid token", rec.Code)
		}
	})
}
