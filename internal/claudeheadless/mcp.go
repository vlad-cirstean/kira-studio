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
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/google/renameio/v2"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/tokenauth"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
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
	// Git, when set, adds the git tool for those worktrees.
	Git *GitGrant
	// Results are the step's declared results; finish_step's status is one of their ids or
	// needs_input. Empty = the implicit done (ok) and failed (not ok).
	Results []ResultSpec
	// Review, when set on a run grant, adds reply_review_comment for those comment ids.
	Review *ReviewGrant
	// Sandbox, when set on a run grant, adds fetch_remote and push_branch: the git operations a
	// sandboxed agent cannot do itself.
	Sandbox *SandboxGrant
}

// ResultSpec is one result a step may report.
type ResultSpec struct {
	ID, Description string
	OK              bool
}

// implicitResults are the results of a step that declares none.
var implicitResults = []ResultSpec{{ID: finishStatusDone, OK: true}, {ID: finishStatusFail}}

// IsImplicit reports whether results are the implicit pair (or none): nothing to restrict or explain.
func IsImplicit(results []ResultSpec) bool {
	return len(results) == 0 || slices.Equal(results, implicitResults)
}

func resultsOrImplicit(r []ResultSpec) []ResultSpec {
	if len(r) == 0 {
		return implicitResults
	}
	return r
}

type registration struct {
	id         uint64 // unique per registration: one run id may register again before the first releases
	grant      Grant
	hash, salt []byte
	// server carries this run's own finish_step schema; nil = the shared server for its flags.
	server *mcp.Server
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
	review   ReviewReplier
	sandbox  SandboxGit
	prompts  llmprompts.Source

	mu     sync.Mutex
	seq    uint64
	tokens []registration
	ln     net.Listener
	srv    *http.Server
	closed bool
	// shared holds the per-flags servers of the revision sharedRev; a prompt edit rebuilds them.
	shared    map[[5]bool]*mcp.Server
	sharedRev uint64
}

// Options configure a Server. Space may be nil: a Space grant is then refused. Outcomes may be nil:
// no grant then lists run_outcome.
type Options struct {
	Dir      string
	OnFinish FinishFunc
	Space    SpaceTools
	Outcomes Outcomes
	// Review answers reply_review_comment calls; nil refuses review grants.
	Review ReviewReplier
	// SandboxGit runs fetch_remote and push_branch; nil refuses sandbox grants.
	SandboxGit SandboxGit
	// Prompts resolves tool and instruction texts; nil means the registry defaults.
	Prompts llmprompts.Source
}

// NewServer returns a stopped Server; config files go in o.Dir (created 0700).
func NewServer(o Options) *Server {
	if o.Prompts == nil {
		o.Prompts = llmprompts.Defaults()
	}
	return &Server{dir: o.Dir, onFinish: o.OnFinish, space: o.Space, outcomes: o.Outcomes, review: o.Review, sandbox: o.SandboxGit, prompts: o.Prompts}
}

type finishArgs struct {
	Status          string   `json:"status"`
	Summary         string   `json:"summary"`
	Reason          string   `json:"reason,omitempty"`
	ConflictedFiles []string `json:"conflictedFiles,omitempty"`
	LastGitError    string   `json:"lastGitError,omitempty"`
	Tried           string   `json:"tried,omitempty"`
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

// statusIDs are the values finish_step's status takes for results: their ids, then needs_input.
func statusIDs(results []ResultSpec) []string {
	results = resultsOrImplicit(results)
	ids := make([]string, 0, len(results)+1)
	for _, r := range results {
		ids = append(ids, r.ID)
	}
	return append(ids, finishStatusNeed)
}

// finishSchema is finish_step's input schema with status restricted to the run's results.
func (s *Server) finishSchema(results []ResultSpec) (*jsonschema.Schema, error) {
	sch := llmprompts.InputSchema[finishArgs](s.prompts, llmprompts.HeadlessToolFinishStep.ID(), map[string]any{
		"status": llmprompts.StatusVars{Results: FinishVars(resultsOrImplicit(results)).Results},
	})
	status := sch.Properties["status"]
	if status == nil {
		return nil, errors.New("claudeheadless: finish_step schema has no status")
	}
	status.Enum = nil
	for _, id := range statusIDs(results) {
		status.Enum = append(status.Enum, id)
	}
	return sch, nil
}

// buildMCPServer returns the tool set a grant sees: an agent never lists a tool it cannot call.
func (s *Server) buildMCPServer(finish, space, outcomes, git, review, sandbox bool, results []ResultSpec) *mcp.Server {
	opts := &mcp.ServerOptions{}
	if space {
		opts.Instructions = llmprompts.HeadlessSpaceInstructions.Text(s.prompts, llmprompts.NoVars{})
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: ServerName, Title: "Kira ADE", Version: "1"}, opts)
	if finish {
		schema, err := s.finishSchema(results)
		if err != nil {
			panic(err) // the schema derives from a fixed type: a failure is a programming error
		}
		mcp.AddTool(srv, &mcp.Tool{
			Name:        "finish_step",
			Description: llmprompts.HeadlessToolFinishStep.Text(s.prompts, llmprompts.NoVars{}),
			InputSchema: schema,
		}, s.finishStep)
	}
	if space {
		s.addSpaceTools(srv)
	}
	if outcomes {
		s.addOutcomeTool(srv)
	}
	if git {
		s.addGitTool(srv)
	}
	if review {
		s.addReviewTool(srv)
	}
	if sandbox {
		s.addSandboxGitTools(srv)
	}
	return srv
}

// registered resolves the registration behind a request; a released registration fails at once.
func (s *Server) registered(info *auth.TokenInfo) (registration, bool) {
	if info == nil || len(info.UserID) <= len(grantPrefix) {
		return registration{}, false
	}
	id, err := strconv.ParseUint(info.UserID[len(grantPrefix):], 10, 64)
	if err != nil {
		return registration{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.tokens {
		if t.id == id {
			return t, true
		}
	}
	return registration{}, false
}

func (s *Server) grant(info *auth.TokenInfo) (Grant, bool) {
	r, ok := s.registered(info)
	return r.grant, ok
}

func toolError(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, IsError: true}
}

func (s *Server) finishStep(_ context.Context, req *mcp.CallToolRequest, args finishArgs) (*mcp.CallToolResult, any, error) {
	var info *auth.TokenInfo
	if req.Extra != nil {
		info = req.Extra.TokenInfo
	}
	g, ok := s.grant(info)
	if !ok || g.RunID == "" {
		return nil, nil, errors.New("finish_step: no run behind this call")
	}
	if allowed := statusIDs(g.Results); !slices.Contains(allowed, args.Status) {
		return toolError(fmt.Sprintf("status must be one of: %s", strings.Join(allowed, ", "))), nil, nil
	}
	if msg := checkFinish(args); msg != "" {
		return toolError(msg), nil, nil
	}
	s.onFinish(g.RunID, Finish{
		Status: args.Status, Summary: args.Summary, Reason: args.Reason, ConflictedFiles: args.ConflictedFiles,
		LastGitError: args.LastGitError, Tried: args.Tried,
	})
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: llmprompts.HeadlessFinishStepAck.Text(s.prompts, llmprompts.NoVars{})}}}, nil, nil
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
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		reg, ok := s.registered(auth.TokenInfoFromContext(r.Context()))
		if !ok {
			return nil
		}
		if reg.server != nil {
			return reg.server
		}
		g := reg.grant
		return s.sharedServer([5]bool{g.RunID != "", g.Space, g.TaskID != "" && s.outcomes != nil, g.Git != nil, g.Sandbox != nil})
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	protected := auth.RequireBearerToken(s.verify, nil)(handler)
	mux := http.NewServeMux()
	mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))
	s.ln = ln
	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(s.srv)
	return nil
}

// sharedServer returns the tool set for a grant's flags, rebuilt when a prompt edit moved the revision.
func (s *Server) sharedServer(key [5]bool) *mcp.Server {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rev := s.prompts.Revision(); s.shared == nil || rev != s.sharedRev {
		s.shared = map[[5]bool]*mcp.Server{}
		s.sharedRev = rev
	}
	srv := s.shared[key]
	if srv == nil && (key[0] || key[1] || key[2] || key[3] || key[4]) {
		srv = s.buildMCPServer(key[0], key[1], key[2], key[3], false, key[4], nil)
		s.shared[key] = srv
	}
	return srv
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
	if g.Git != nil {
		wts := make([]string, len(g.Git.Worktrees))
		for i, w := range g.Git.Worktrees {
			wts[i] = filepath.Clean(w)
		}
		g.Git = &GitGrant{Worktrees: wts, Push: g.Git.Push}
	}
	if g.Review != nil {
		if g.RunID == "" || s.review == nil {
			return "", nil, errors.New("claudeheadless: review grant needs a run and a review replier")
		}
		g.Review = &ReviewGrant{CommentIDs: slices.Clone(g.Review.CommentIDs)}
	}
	if g.Sandbox != nil {
		if g.RunID == "" || s.sandbox == nil {
			return "", nil, errors.New("claudeheadless: sandbox grant needs a run and sandbox git tools")
		}
		g.Sandbox = &SandboxGrant{Push: g.Sandbox.Push}
	}
	var perRun *mcp.Server
	if g.RunID != "" && (!IsImplicit(g.Results) || g.Review != nil) {
		perRun = s.buildMCPServer(true, g.Space, g.TaskID != "" && s.outcomes != nil, g.Git != nil, g.Review != nil, g.Sandbox != nil, g.Results)
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
	s.tokens = append(s.tokens, registration{id: id, grant: g, hash: hash, salt: salt, server: perRun})
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
		err = renameio.WriteFile(path, cfg, 0o600)
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

// Port is the loopback port the server listens on, 0 before the first Register.
func (s *Server) Port() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln == nil {
		return 0
	}
	if a, ok := s.ln.Addr().(*net.TCPAddr); ok {
		return a.Port
	}
	return 0
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
