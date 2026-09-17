// Package agenthooks is P86's own hook-transport layer: a per-process HTTP-over-unix-socket
// listener that a launched `claude` process's own lifecycle hooks report into (§5.1). It is a
// domain package — it must not import internal/bridge (internal/layering_test.go's
// TestDomainPackagesDoNotImportBridge picks this package up automatically from `go list`, the
// same rule internal/terminal's own package comment records); internal/bridge/agenthooks.go is
// the one place that turns Options.OnEvent's callback into a push-channel event and this
// package's plain error into an ipcerr response.
package agenthooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// closeHTTPGraceTimeout mirrors internal/dbmcp/http.go's own bound on Close's graceful Shutdown
// wait — a hook's own request handler never blocks on anything but decoding a bounded body, so
// this is a generous backstop, not a value tuned against a known slow path.
const closeHTTPGraceTimeout = 5 * time.Second

// Event is what the listener hands to Options.OnEvent — the nine hook-payload fields this app
// keeps (§6), plus TerminalID from the X-Kira-Terminal header (not the body). tool_input,
// tool_response and transcript_path are never decoded into anything, so they can never reach
// here — encoding/json silently skips a body field with no matching struct tag, which is the
// actual mechanism behind "the listener keeps nine fields and drops the rest without logging".
type Event struct {
	TerminalID       string `json:"terminalId"`
	Event            string `json:"event"`
	SessionID        string `json:"sessionId"`
	Cwd              string `json:"cwd"`
	ToolName         string `json:"toolName"`
	ToolUseID        string `json:"toolUseId"`
	NotificationType string `json:"notificationType"`
	Message          string `json:"message"`
	Source           string `json:"source"`
	Reason           string `json:"reason"`
}

// Options configures a Server.
type Options struct {
	// OnEvent is called once per accepted hook request, from that request's own handler goroutine
	// (net/http's usual one-goroutine-per-request model) — never after Close returns.
	OnEvent func(Event)
}

// Server owns, for its own lifetime: a 0700 temp directory, the generated hooks.json (§2.4), the
// shim script (§5.2), a 0600 unix socket and the http.Server serving POST /hook over it. One
// instance per enable — internal/bridge/agenthooks.go's AgentHooksService constructs and closes
// one each time the setting toggles on, mirroring internal/dbmcp.Server's own start/stop shape.
type Server struct {
	dir       string
	hooksPath string
	shimPath  string
	sockPath  string
	token     string
	onEvent   func(Event)

	listener net.Listener
	http     *http.Server
}

// New resolves curl, builds the temp directory/shim/socket/hooks.json, starts serving in its own
// goroutine, and returns. A failure here is never fatal to the caller — AgentHooksService.
// SetEnabled/startLocked surfaces it as AgentHooksStatus.Error (§5.2), the same "enabling fails
// loudly, nothing silently degrades" posture DbMcpService already takes for a bind failure.
func New(opts Options) (*Server, error) {
	curlPath, err := exec.LookPath("curl")
	if err != nil {
		return nil, errors.New("curl not found; hooks cannot report")
	}

	// POSIX mkdtemp(3) creates the directory 0700 already; os.MkdirTemp is documented to use it —
	// gitaskpass.New's own identical precedent (D8's security boundary): no other OS user can read
	// the shim, the token or reach the socket.
	dir, err := os.MkdirTemp("", "kira-agent-")
	if err != nil {
		return nil, fmt.Errorf("agenthooks: mkdtemp: %w", err)
	}

	token, err := randHex(32)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("agenthooks: token: %w", err)
	}

	// Named "s" (gitaskpass's own precedent, §5.1): macOS caps sun_path at 104 bytes, so the
	// socket's own filename has to stay short.
	sockPath := filepath.Join(dir, "s")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("agenthooks: listen: %w", err)
	}
	if err := os.Chmod(sockPath, 0o600); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("agenthooks: chmod socket: %w", err)
	}

	shimBody, err := buildShim(curlPath, sockPath)
	if err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	shimPath := filepath.Join(dir, "hook")
	if err := os.WriteFile(shimPath, []byte(shimBody), 0o700); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("agenthooks: write shim: %w", err)
	}

	quotedShim, err := ShellSingleQuote(shimPath)
	if err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	hooksDoc, err := buildHooksDocument(quotedShim)
	if err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, err
	}
	hooksPath := filepath.Join(dir, "hooks.json")
	if err := os.WriteFile(hooksPath, hooksDoc, 0o600); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("agenthooks: write hooks.json: %w", err)
	}

	s := &Server{
		dir: dir, hooksPath: hooksPath, shimPath: shimPath, sockPath: sockPath, token: token,
		onEvent:  opts.OnEvent,
		listener: ln,
	}
	s.http = &http.Server{
		Handler: s.mux(),
		// Same bounds as internal/dbmcp/http.go's own bindHTTP — a slowloris-shaped header and a
		// connection that never issues a second request, applied to this socket instead of a TCP
		// listener.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		if err := s.http.Serve(s.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			_ = err // Serve's own error after Close is expected (listener closed); nothing to log.
		}
	}()

	return s, nil
}

func randHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// SettingsPath is the generated hooks.json's own absolute path — internal/bridge/terminal.go's
// `--settings` flag value, and the Settings section's own "outside your project" proof (§9.3).
func (s *Server) SettingsPath() string {
	return s.hooksPath
}

// Env is the three variables a Claude Code launch's shell needs to reach this server (§5.4):
// KIRA_TERMINAL_ID correlates every hook back to terminalID's own tab (§5.3), the other two point
// the shim at this instance's own socket and token.
func (s *Server) Env(terminalID string) []string {
	return []string{
		"KIRA_TERMINAL_ID=" + terminalID,
		"KIRA_AGENT_HOOK_SOCKET=" + s.sockPath,
		"KIRA_AGENT_HOOK_TOKEN=" + s.token,
	}
}

// Close shuts the HTTP server down with a bounded context (dbmcp/http.go's own closeHTTP
// precedent) and removes the whole temp directory — the shim, hooks.json and the socket file
// along with it. A running Claude Code session whose hooks now post into a closed socket is
// unaffected (§7): the shim always exits 0.
func (s *Server) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), closeHTTPGraceTimeout)
	defer cancel()
	var err error
	if shutdownErr := s.http.Shutdown(ctx); shutdownErr != nil {
		_ = s.http.Close()
		err = shutdownErr
	}
	if rmErr := os.RemoveAll(s.dir); err == nil {
		err = rmErr
	}
	return err
}
