package repomap

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpPath is where the Streamable HTTP handler is mounted — matches the shape of every URL
// `claude mcp add --transport http`'s own documentation and --help examples use (a path ending in
// "/mcp").
const mcpPath = "/mcp"

// httpState is server.go's own Server struct split out for this file's cohesion (§2's layout):
// everything to do with binding, serving and tearing down the HTTP listener.
type httpState struct {
	listener net.Listener
	http     *http.Server
}

// bindHTTP tries DefaultPort first, falls back to an OS-assigned ephemeral port on conflict (§5) —
// never 0.0.0.0, always loopback only — mounts the auth-wrapped Streamable HTTP handler, and
// records the bound listener. Does not start serving; call Serve for that.
func (s *Server) bindHTTP() error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", DefaultPort))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return fmt.Errorf("repomap: bind: %w", err)
		}
	}

	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return s.mcp }, &mcp.StreamableHTTPOptions{
		Stateless: true,
	})

	verifier := s.tokenVerifier()
	protected := auth.RequireBearerToken(verifier, &auth.RequireBearerTokenOptions{
		// D8's own token carries no exp claim — it is not OAuth-shaped, so the middleware's default
		// "every TokenInfo must carry an Expiration" reject is opted out of here.
		AllowMissingExpiration: true,
	})(handler)

	// The go-sdk (v1.7.0) applies DNS-rebinding protection by default but explicitly does not
	// apply cross-origin protection unless the caller wraps the handler itself (its own deprecation
	// note on the removed in-SDK option names this exact replacement) — P67d §4.1: this server is
	// no longer dev-only, so a browser tab on an unrelated origin must not be able to reach it just
	// because it happens to be running on localhost.
	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))

	s.listener = ln
	s.http = &http.Server{
		Handler: mux,
		// ReadHeaderTimeout bounds a slowloris-shaped client; IdleTimeout reclaims a connection
		// that never issues a second request. WriteTimeout and ReadTimeout stay unset, deliberately
		// (P67d §4.2): the Streamable HTTP transport holds long-lived server-to-client streams, and
		// a slow client body on a long POST is not a threat on loopback the way a slow header is.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	return nil
}

// tokenVerifier is this instance's own auth.TokenVerifier (D8): constant-time compare against the
// token Config.Token resolved at construction. A Server constructed with a zero-value Token (should
// never happen outside a test — every real caller resolves one via mcpauth first) rejects every
// request, fail-closed.
func (s *Server) tokenVerifier() auth.TokenVerifier {
	return func(_ context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
		s.tokenMu.RLock()
		rec := s.token
		s.tokenMu.RUnlock()
		if len(rec.Hash) == 0 || !mcpauth.Verify(token, rec) {
			return nil, auth.ErrInvalidToken
		}
		return &auth.TokenInfo{}, nil
	}
}

// Port returns the actually-bound port — the default, or the ephemeral fallback (§5).
func (s *Server) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

// URL returns this instance's own MCP endpoint, e.g. "http://127.0.0.1:8765/mcp".
func (s *Server) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", s.Port(), mcpPath)
}

// Serve blocks, accepting connections on the already-bound listener, until Close is called (or the
// listener otherwise fails). The headless binary calls this directly (its own main blocks here);
// the embedded instance runs it in its own goroutine (`go srv.Serve()`, bridge/repomap.go).
func (s *Server) Serve() error {
	err := s.http.Serve(s.listener)
	if err != nil && errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) closeHTTP() error {
	if s.http == nil {
		return nil
	}
	return s.http.Shutdown(context.Background())
}
