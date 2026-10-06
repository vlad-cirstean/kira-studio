package adeagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/tokenauth"
)

const (
	mcpPath          = "/mcp"
	closeGracePeriod = 5 * time.Second
	finishStatusDone = "done"
	finishStatusFail = "failed"
	finishStatusNeed = "needs_input"
)

// FinishFunc receives a run's finish_step call. The last call of a run wins; the caller applies the
// outcome when the process exits.
type FinishFunc func(runID, status, summary string)

type runToken struct {
	id         uint64 // unique per registration: one run id may register again before the first releases
	runID      string
	hash, salt []byte
}

// Server is the loopback MCP server a headless run reports through. It listens on 127.0.0.1 with
// an OS-assigned port, started by the first Register. Each run gets its own bearer token and a
// 0600 config file holding it; the token never reaches argv.
type Server struct {
	dir      string
	onFinish FinishFunc

	mu     sync.Mutex
	seq    uint64
	tokens []runToken
	ln     net.Listener
	srv    *http.Server
	closed bool
}

// NewServer returns a stopped Server; config files go in dir (created 0700).
func NewServer(dir string, onFinish FinishFunc) *Server {
	return &Server{dir: dir, onFinish: onFinish}
}

type finishArgs struct {
	Status  string `json:"status" jsonschema:"done when the step is complete, failed when it could not be completed, needs_input when a decision from the user is needed."`
	Summary string `json:"summary" jsonschema:"One line: what was done, what failed, or the question for the user."`
}

func (s *Server) buildMCPServer() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: ServerName, Title: "Kira ADE", Version: "1"}, nil)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "finish_step",
		Description: "Report how this pipeline step ended. Call it exactly once, as the last action.",
	}, s.finishStep)
	return srv
}

func (s *Server) finishStep(_ context.Context, req *mcp.CallToolRequest, args finishArgs) (*mcp.CallToolResult, any, error) {
	switch args.Status {
	case finishStatusDone, finishStatusFail, finishStatusNeed:
	default:
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: `status must be "done", "failed" or "needs_input"`}},
			IsError: true,
		}, nil, nil
	}
	if req.Extra == nil || req.Extra.TokenInfo == nil || req.Extra.TokenInfo.UserID == "" {
		return nil, nil, errors.New("finish_step: no run behind this call")
	}
	s.onFinish(req.Extra.TokenInfo.UserID, args.Status, args.Summary)
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "Recorded. Stop now."}}}, nil, nil
}

// verify maps a presented bearer token to the run it was minted for.
func (s *Server) verify(_ context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.tokens {
		if tokenauth.Verify(token, t.hash, t.salt) {
			return &auth.TokenInfo{UserID: t.runID, Expiration: time.Now().Add(24 * time.Hour)}, nil
		}
	}
	return nil, auth.ErrInvalidToken
}

// startLocked binds the listener and begins serving; s.mu is held.
func (s *Server) startLocked() error {
	if s.closed {
		return errors.New("adeagent: server is closed")
	}
	if s.ln != nil {
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("adeagent: bind: %w", err)
	}
	mcpSrv := s.buildMCPServer()
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return mcpSrv }, &mcp.StreamableHTTPOptions{Stateless: true})
	protected := auth.RequireBearerToken(s.verify, nil)(handler)
	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))
	s.ln = ln
	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(s.srv)
	return nil
}

// Register mints a token for runID, writes the run's MCP config file and returns its path. release
// deletes that registration's file and token only; call it when the process has exited.
func (s *Server) Register(runID string) (configPath string, release func(), err error) {
	plain, hash, salt, err := tokenauth.Mint()
	if err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return "", nil, fmt.Errorf("adeagent: config dir: %w", err)
	}
	s.mu.Lock()
	if err := s.startLocked(); err != nil {
		s.mu.Unlock()
		return "", nil, err
	}
	url := "http://" + s.ln.Addr().String() + mcpPath
	s.seq++
	id := s.seq
	s.tokens = append(s.tokens, runToken{id: id, runID: runID, hash: hash, salt: salt})
	s.mu.Unlock()

	cfg, err := json.Marshal(map[string]any{"mcpServers": map[string]any{ServerName: map[string]any{
		"type": "http", "url": url, "headers": map[string]string{"Authorization": "Bearer " + plain},
	}}})
	path := filepath.Join(s.dir, fmt.Sprintf("%s-%d.mcp.json", runID, id))
	if err == nil {
		err = os.WriteFile(path, cfg, 0o600)
	}
	release = func() {
		_ = os.Remove(path)
		s.forget(id)
	}
	if err != nil {
		release()
		return "", nil, fmt.Errorf("adeagent: write mcp config: %w", err)
	}
	return path, release, nil
}

func (s *Server) forget(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.tokens[:0]
	for _, t := range s.tokens {
		if t.id != id {
			kept = append(kept, t)
		}
	}
	s.tokens = kept
}

// Close stops the listener; later Register calls fail.
func (s *Server) Close() error {
	s.mu.Lock()
	s.closed = true
	srv := s.srv
	s.srv, s.ln, s.tokens = nil, nil, nil
	s.mu.Unlock()
	if srv == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), closeGracePeriod)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		_ = srv.Close()
		return err
	}
	return nil
}
