package dbmcp

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

// closeHTTPGraceTimeout bounds closeHTTP's own graceful Shutdown wait (finding #17, M6):
// http.Server.Shutdown given context.Background() blocks until every in-flight handler returns,
// with no deadline of its own — a run_query handler parked in ApprovalBroker.Request (M2 §5.3)
// would never return on its own, so an unbounded Shutdown here would hang the whole app-quit path
// on it. bridge/dbmcp.go's stopLocked unblocks that handler first (AbandonAll before Close), so
// this deadline is normally never reached — it exists as the hard backstop for whatever ordering
// mistake or slow handler reaches it anyway, matching mcpinstall/exec.go's own
// grace-then-force shape.
const closeHTTPGraceTimeout = 5 * time.Second

// mcpPath is every `claude mcp add --transport http` example's own convention — ends in "/mcp".
const mcpPath = "/mcp"

// httpState is server.go's own Server struct split out for this file's cohesion.
type httpState struct {
	listener net.Listener
	http     *http.Server
}

// bindHTTP tries DefaultPort first, falls back to an OS-assigned ephemeral port on conflict — never
// 0.0.0.0, always loopback only (§3.2) — mounts the auth-wrapped Streamable HTTP handler, and
// records the bound listener. Does not start serving; call Serve for that.
func (s *Server) bindHTTP() error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", DefaultPort))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return fmt.Errorf("dbmcp: bind: %w", err)
		}
	}

	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return s.mcp }, &mcp.StreamableHTTPOptions{
		Stateless: true,
	})

	verifier := s.tokenVerifier()
	protected := auth.RequireBearerToken(verifier, &auth.RequireBearerTokenOptions{
		// mcpauth.Check does its own expiry test and reports OutcomeExpired with an actionable
		// message (M1 §2.5); the SDK's own Expiration-based check would only ever see a zero
		// TokenInfo.Expiration (deliberately left empty, see tokenVerifier below) and produce its
		// own flat "token missing expiration" body instead, so that check stays opted out here.
		AllowMissingExpiration: true,
	})(handler)

	// The go-sdk applies DNS-rebinding protection by default but explicitly does not apply
	// cross-origin protection unless the caller wraps the handler itself: a browser tab on an
	// unrelated origin must not be able to reach it just because it happens to be running on
	// loopback.
	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))

	s.listener = ln
	s.http = &http.Server{
		Handler: mux,
		// ReadHeaderTimeout bounds a slowloris-shaped client; IdleTimeout reclaims a connection
		// that never issues a second request.
		// WriteTimeout/ReadTimeout stay unset: the Streamable HTTP transport holds long-lived
		// server-to-client streams, and a slow client body on a long POST is not a threat on
		// loopback the way a slow header is.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	return nil
}

// tokenVerifier is this instance's own auth.TokenVerifier: mcpauth.TokenVerifier reads the current
// record under s.tokenMu on every request, so a Regenerate mid-flight is picked up by the very
// next one.
func (s *Server) tokenVerifier() auth.TokenVerifier {
	return mcpauth.TokenVerifier("kira-db", func() mcpauth.Record {
		s.tokenMu.RLock()
		defer s.tokenMu.RUnlock()
		return s.token
	})
}

// Port returns the actually-bound port — DefaultPort, or the ephemeral fallback.
func (s *Server) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

// URL returns this instance's own MCP endpoint, e.g. "http://127.0.0.1:8766/mcp".
func (s *Server) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", s.Port(), mcpPath)
}

// Serve blocks, accepting connections on the already-bound listener, until Close is called (or the
// listener otherwise fails). bridge/dbmcp.go runs this in its own goroutine (`go srv.Serve()`).
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
	ctx, cancel := context.WithTimeout(context.Background(), closeHTTPGraceTimeout)
	defer cancel()
	if err := s.http.Shutdown(ctx); err != nil {
		// Shutdown's own deadline lapsed (or another error) — Close never blocks on an in-flight
		// handler, dropping any connection still open rather than hanging the app-quit path on it.
		_ = s.http.Close()
		return err
	}
	return nil
}
