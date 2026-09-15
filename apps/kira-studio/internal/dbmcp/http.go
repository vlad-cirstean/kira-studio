package dbmcp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpPath mirrors repomap/http.go's own choice — every `claude mcp add --transport http` example
// ends in "/mcp".
const mcpPath = "/mcp"

// httpState is server.go's own Server struct split out for this file's cohesion — repomap/http.go's
// identical layout.
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
		// own flat "token missing expiration" body instead, so that check stays opted out here —
		// repomap/http.go's identical reasoning, applied to this server's own token.
		AllowMissingExpiration: true,
	})(handler)

	mux := http.NewServeMux()
	mux.Handle(mcpPath, protected)

	s.listener = ln
	s.http = &http.Server{Handler: mux}
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
	return s.http.Shutdown(context.Background())
}
