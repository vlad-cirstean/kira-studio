package claudeheadless

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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

// Finish is one finish_step call. Reason, ConflictedFiles, LastGitError and Tried are optional detail
// for a failure or a question.
type Finish struct {
	Status, Summary, Reason string
	ConflictedFiles         []string
	LastGitError, Tried     string
}

// FinishFunc receives a run's finish_step call. The last call of a run wins; the caller applies the
// outcome when the process exits.
type FinishFunc func(runID string, f Finish)

// Bounds on a finish_step call's text fields.
const (
	maxFinishText    = 1 << 10
	maxFinishGitErr  = 4 << 10
	maxFinishFiles   = 200
	maxFinishFileLen = 1 << 10
)

// Grant is what one registration may do. A run grant reports through finish_step; a Space grant
// adds the task tools, which act on TaskID alone.
type Grant struct {
	RunID  string
	TaskID string
	Space  bool
}

type registration struct {
	id         uint64 // unique per registration: one run id may register again before the first releases
	grant      Grant
	hash, salt []byte
}

const grantPrefix = "g"

// Server is the loopback MCP server a headless run reports through. It listens on 127.0.0.1 with
// an OS-assigned port, started by the first Register. Each run gets its own bearer token and a
// 0600 config file holding it; the token never reaches argv.
type Server struct {
	dir      string
	onFinish FinishFunc
	space    SpaceTools
	outcomes Outcomes

	mu     sync.Mutex
	seq    uint64
	tokens []registration
	ln     net.Listener
	srv    *http.Server
	closed bool
}

// NewServer returns a stopped Server; config files go in dir (created 0700). space may be nil: a
// Space grant is then refused.
func NewServer(dir string, onFinish FinishFunc, space SpaceTools, outcomes Outcomes) *Server {
	return &Server{dir: dir, onFinish: onFinish, space: space, outcomes: outcomes}
}

type finishArgs struct {
	Status          string   `json:"status" jsonschema:"done when the step is complete, failed when it could not be completed, needs_input when a decision from the user is needed."`
	Summary         string   `json:"summary" jsonschema:"One line: what was done, what failed, or the question for the user."`
	Reason          string   `json:"reason,omitempty" jsonschema:"Why it failed, or what you need. Give it when status is failed or needs_input."`
	ConflictedFiles []string `json:"conflictedFiles,omitempty" jsonschema:"Files that still conflict, relative to the repo."`
	LastGitError    string   `json:"lastGitError,omitempty" jsonschema:"The last git error output you saw."`
	Tried           string   `json:"tried,omitempty" jsonschema:"What you tried before giving up."`
}

// checkFinish bounds the call's text fields; the error names the field.
func checkFinish(a finishArgs) string {
	for _, f := range []struct {
		name string
		v    string
		max  int
	}{{"summary", a.Summary, maxFinishText}, {"reason", a.Reason, maxFinishText}, {"tried", a.Tried, maxFinishText}, {"lastGitError", a.LastGitError, maxFinishGitErr}} {
		if len(f.v) > f.max {
			return fmt.Sprintf("%s is too long: at most %d bytes", f.name, f.max)
		}
	}
	if len(a.ConflictedFiles) > maxFinishFiles {
		return fmt.Sprintf("conflictedFiles has too many entries: at most %d", maxFinishFiles)
	}
	for _, f := range a.ConflictedFiles {
		if len(f) > maxFinishFileLen {
			return fmt.Sprintf("a conflictedFiles entry is too long: at most %d bytes", maxFinishFileLen)
		}
	}
	return ""
}

// buildMCPServer returns the tool set a grant sees: an agent never lists a tool it cannot call.
func (s *Server) buildMCPServer(finish, space, outcomes bool) *mcp.Server {
	opts := &mcp.ServerOptions{}
	if space {
		opts.Instructions = spaceInstructions
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: ServerName, Title: "Kira ADE", Version: "1"}, opts)
	if finish {
		mcp.AddTool(srv, &mcp.Tool{
			Name:        "finish_step",
			Description: "Report how this pipeline step ended. Call it exactly once, as the last action.",
		}, s.finishStep)
	}
	if space {
		s.addSpaceTools(srv)
	}
	if outcomes {
		s.addOutcomeTool(srv)
	}
	return srv
}

// grant resolves the registration behind a request; a released registration fails at once.
func (s *Server) grant(info *auth.TokenInfo) (Grant, bool) {
	if info == nil || len(info.UserID) <= len(grantPrefix) {
		return Grant{}, false
	}
	id, err := strconv.ParseUint(info.UserID[len(grantPrefix):], 10, 64)
	if err != nil {
		return Grant{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.tokens {
		if t.id == id {
			return t.grant, true
		}
	}
	return Grant{}, false
}

func toolError(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, IsError: true}
}

func (s *Server) finishStep(_ context.Context, req *mcp.CallToolRequest, args finishArgs) (*mcp.CallToolResult, any, error) {
	switch args.Status {
	case finishStatusDone, finishStatusFail, finishStatusNeed:
	default:
		return toolError(`status must be "done", "failed" or "needs_input"`), nil, nil
	}
	if msg := checkFinish(args); msg != "" {
		return toolError(msg), nil, nil
	}
	var info *auth.TokenInfo
	if req.Extra != nil {
		info = req.Extra.TokenInfo
	}
	g, ok := s.grant(info)
	if !ok || g.RunID == "" {
		return nil, nil, errors.New("finish_step: no run behind this call")
	}
	s.onFinish(g.RunID, Finish{
		Status: args.Status, Summary: args.Summary, Reason: args.Reason, ConflictedFiles: args.ConflictedFiles,
		LastGitError: args.LastGitError, Tried: args.Tried,
	})
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "Recorded. Stop now."}}}, nil, nil
}

// verify maps a presented bearer token to the registration it was minted for.
func (s *Server) verify(_ context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.tokens {
		if tokenauth.Verify(token, t.hash, t.salt) {
			return &auth.TokenInfo{UserID: grantPrefix + strconv.FormatUint(t.id, 10), Expiration: time.Now().Add(24 * time.Hour)}, nil
		}
	}
	return nil, auth.ErrInvalidToken
}

// startLocked binds the listener and begins serving; s.mu is held.
func (s *Server) startLocked() error {
	if s.closed {
		return errors.New("claudeheadless: server is closed")
	}
	if s.ln != nil {
		return nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("claudeheadless: bind: %w", err)
	}
	servers := map[[3]bool]*mcp.Server{}
	for _, finish := range []bool{false, true} {
		for _, space := range []bool{false, true} {
			for _, outcomes := range []bool{false, true} {
				if finish || space || outcomes {
					servers[[3]bool{finish, space, outcomes}] = s.buildMCPServer(finish, space, outcomes)
				}
			}
		}
	}
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		g, ok := s.grant(auth.TokenInfoFromContext(r.Context()))
		if !ok {
			return nil
		}
		return servers[[3]bool{g.RunID != "", g.Space, g.TaskID != "" && s.outcomes != nil}]
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	protected := auth.RequireBearerToken(s.verify, nil)(handler)
	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))
	s.ln = ln
	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(s.srv)
	return nil
}

// Register mints a token for the grant, writes its MCP config file and returns its path. release
// deletes that registration's file and token only; call it when the process has exited.
func (s *Server) Register(g Grant) (configPath string, release func(), err error) {
	if g.RunID == "" && !g.Space {
		return "", nil, errors.New("claudeheadless: grant allows nothing")
	}
	if g.Space && (g.TaskID == "" || s.space == nil) {
		return "", nil, errors.New("claudeheadless: space grant needs a task and space tools")
	}
	plain, hash, salt, err := tokenauth.Mint()
	if err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return "", nil, fmt.Errorf("claudeheadless: config dir: %w", err)
	}
	s.mu.Lock()
	if err := s.startLocked(); err != nil {
		s.mu.Unlock()
		return "", nil, err
	}
	url := "http://" + s.ln.Addr().String() + mcpPath
	s.seq++
	id := s.seq
	s.tokens = append(s.tokens, registration{id: id, grant: g, hash: hash, salt: salt})
	s.mu.Unlock()

	cfg, err := json.Marshal(map[string]any{"mcpServers": map[string]any{ServerName: map[string]any{
		"type": "http", "url": url, "headers": map[string]string{"Authorization": "Bearer " + plain},
	}}})
	name := g.RunID
	if name == "" {
		name = "task-" + g.TaskID
	}
	path := filepath.Join(s.dir, fmt.Sprintf("%s-%d.mcp.json", name, id))
	if err == nil {
		err = os.WriteFile(path, cfg, 0o600)
	}
	release = func() {
		_ = os.Remove(path)
		s.forget(id)
	}
	if err != nil {
		release()
		return "", nil, fmt.Errorf("claudeheadless: write mcp config: %w", err)
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
