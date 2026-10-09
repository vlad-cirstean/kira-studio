package claudeheadless

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

func connect(t *testing.T, cfgPath, tokenOverride string) (*mcp.ClientSession, error) {
	t.Helper()
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		MCPServers map[string]struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	entry := cfg.MCPServers[ServerName]
	token := entry.Headers["Authorization"][len("Bearer "):]
	if tokenOverride != "" {
		token = tokenOverride
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	return client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: entry.URL, HTTPClient: &http.Client{Transport: bearerTransport{token}}, DisableStandaloneSSE: true, MaxRetries: -1,
	}, nil)
}

func TestFinishStepServer(t *testing.T) {
	var mu sync.Mutex
	var got []string
	srv := NewServer(t.TempDir(), func(runID string, f Finish) {
		mu.Lock()
		got = append(got, runID+"|"+f.Status+"|"+f.Summary)
		mu.Unlock()
	}, nil, nil)
	t.Cleanup(func() { _ = srv.Close() })
	cfgA, releaseA, err := srv.Register(Grant{RunID: "run-a"})
	if err != nil {
		t.Fatal(err)
	}
	cfgB, releaseB, err := srv.Register(Grant{RunID: "run-b"})
	if err != nil {
		t.Fatal(err)
	}
	defer releaseB()

	if info, err := os.Stat(cfgA); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("config file mode = %v, %v; want 0600", info, err)
	}
	if _, err := connect(t, cfgA, "not-a-valid-token"); err == nil {
		t.Fatal("a wrong bearer token connected")
	}

	sess, err := connect(t, cfgA, "")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	call := func(s *mcp.ClientSession, status string) *mcp.CallToolResult {
		res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "finish_step", Arguments: map[string]any{"status": status, "summary": "s-" + status}})
		if err != nil {
			t.Fatalf("call: %v", err)
		}
		return res
	}
	if res := call(sess, "bogus"); !res.IsError {
		t.Fatal("invalid status accepted")
	}
	if res := call(sess, "done"); res.IsError {
		t.Fatalf("done refused: %v", res.Content)
	}
	sessB, err := connect(t, cfgB, "")
	if err != nil {
		t.Fatal(err)
	}
	call(sessB, "failed")
	mu.Lock()
	want := []string{"run-a|done|s-done", "run-b|failed|s-failed"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("finish calls = %v, want %v", got, want)
	}
	mu.Unlock()

	releaseA()
	if _, err := os.Stat(cfgA); !os.IsNotExist(err) {
		t.Fatal("config file survives release")
	}
	if _, err := connect(t, cfgB, "run-a-token-forgotten"); err == nil {
		t.Fatal("forgotten token connected")
	}
}

type fakeSpace struct {
	mu    sync.Mutex
	calls []string
}

func (f *fakeSpace) rec(s string) {
	f.mu.Lock()
	f.calls = append(f.calls, s)
	f.mu.Unlock()
}

func (f *fakeSpace) TaskInfo(_ context.Context, task string) (TaskInfo, error) {
	f.rec("info|" + task)
	return TaskInfo{Title: "t-" + task, Repos: []TaskRepo{}, Registered: []RegisteredRepo{}}, nil
}

func (f *fakeSpace) DeclareRepos(_ context.Context, task string, repos []string) (TaskInfo, error) {
	f.rec("declare|" + task + "|" + repos[0])
	return TaskInfo{Title: "t-" + task, Repos: []TaskRepo{}, Registered: []RegisteredRepo{}}, nil
}

func (f *fakeSpace) RequestBranch(_ context.Context, task, repo, name string) (BranchInfo, error) {
	f.rec("branch|" + task + "|" + repo + "|" + name)
	if name == "main" {
		return BranchInfo{}, ToolError("main is the repo's main branch")
	}
	return BranchInfo{Repo: repo, Branch: name}, nil
}

func (f *fakeSpace) BranchStatus(_ context.Context, task, repo string, _ time.Duration) (BranchInfo, error) {
	f.rec("status|" + task + "|" + repo)
	return BranchInfo{Repo: repo}, nil
}

func toolNames(t *testing.T, s *mcp.ClientSession) map[string]bool {
	t.Helper()
	res, err := s.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, tool := range res.Tools {
		out[tool.Name] = true
	}
	return out
}

// A grant exposes only its own tools and acts on its own task; a released token is dead.
func TestGrantScopes(t *testing.T) {
	space := &fakeSpace{}
	var finished []string
	srv := NewServer(t.TempDir(), func(runID string, f Finish) { finished = append(finished, runID+"|"+f.Status) }, space, nil)
	t.Cleanup(func() { _ = srv.Close() })

	cfgRun, relRun, err := srv.Register(Grant{RunID: "run-1", TaskID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	defer relRun()
	cfgSpace, relSpace, err := srv.Register(Grant{TaskID: "task-1", Space: true})
	if err != nil {
		t.Fatal(err)
	}
	cfgBoth, relBoth, err := srv.Register(Grant{RunID: "run-2", TaskID: "task-2", Space: true})
	if err != nil {
		t.Fatal(err)
	}
	defer relBoth()

	run, err := connect(t, cfgRun, "")
	if err != nil {
		t.Fatal(err)
	}
	if names := toolNames(t, run); !names["finish_step"] || names["request_branch"] || names["task_info"] {
		t.Fatalf("run-only grant tools = %v", names)
	}
	if res, err := run.CallTool(context.Background(), &mcp.CallToolParams{Name: "request_branch", Arguments: map[string]any{"repo": "r", "name": "x"}}); err == nil && !res.IsError {
		t.Fatal("run-only grant called a Space tool")
	}

	sp, err := connect(t, cfgSpace, "")
	if err != nil {
		t.Fatal(err)
	}
	if names := toolNames(t, sp); names["finish_step"] || !names["request_branch"] || !names["declare_repos"] || !names["task_info"] || !names["branch_status"] {
		t.Fatalf("space-only grant tools = %v", names)
	}
	if res, err := sp.CallTool(context.Background(), &mcp.CallToolParams{Name: "finish_step", Arguments: map[string]any{"status": "done", "summary": "x"}}); err == nil && !res.IsError {
		t.Fatal("space-only grant called finish_step")
	}
	if len(finished) != 0 {
		t.Fatalf("finish_step ran for a space grant: %v", finished)
	}

	both, err := connect(t, cfgBoth, "")
	if err != nil {
		t.Fatal(err)
	}
	res, err := both.CallTool(context.Background(), &mcp.CallToolParams{Name: "request_branch", Arguments: map[string]any{"repo": "api", "name": "feat/x"}})
	if err != nil || res.IsError {
		t.Fatalf("request_branch: %v %v", err, res)
	}
	if _, err := sp.CallTool(context.Background(), &mcp.CallToolParams{Name: "task_info"}); err != nil {
		t.Fatal(err)
	}
	res, err = both.CallTool(context.Background(), &mcp.CallToolParams{Name: "request_branch", Arguments: map[string]any{"repo": "api", "name": "main"}})
	if err != nil || !res.IsError {
		t.Fatalf("a ToolError must come back as an error result: %v %v", err, res)
	}
	space.mu.Lock()
	got := space.calls
	space.mu.Unlock()
	want := []string{"branch|task-2|api|feat/x", "info|task-1", "branch|task-2|api|main"}
	if len(got) != len(want) {
		t.Fatalf("calls = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("calls = %v, want %v", got, want)
		}
	}

	raw, err := os.ReadFile(cfgSpace)
	if err != nil {
		t.Fatal(err)
	}
	kept := filepath.Join(t.TempDir(), "kept.json")
	if err := os.WriteFile(kept, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	relSpace()
	if _, err := connect(t, kept, ""); err == nil {
		t.Fatal("a released grant connected")
	}
}

func TestRegisterRefusesUselessGrants(t *testing.T) {
	srv := NewServer(t.TempDir(), func(string, Finish) {}, &fakeSpace{}, nil)
	t.Cleanup(func() { _ = srv.Close() })
	for _, g := range []Grant{{}, {Space: true}, {RunID: "r", Space: true}} {
		if _, _, err := srv.Register(g); err == nil {
			t.Errorf("Register(%+v) accepted", g)
		}
	}
	noTools := NewServer(t.TempDir(), func(string, Finish) {}, nil, nil)
	t.Cleanup(func() { _ = noTools.Close() })
	if _, _, err := noTools.Register(Grant{TaskID: "t", Space: true}); err == nil {
		t.Error("a Space grant without tools accepted")
	}
}
