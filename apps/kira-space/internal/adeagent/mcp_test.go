package adeagent

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
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
	srv := NewServer(t.TempDir(), func(runID, status, summary string) {
		mu.Lock()
		got = append(got, runID+"|"+status+"|"+summary)
		mu.Unlock()
	})
	t.Cleanup(func() { _ = srv.Close() })
	cfgA, releaseA, err := srv.Register("run-a")
	if err != nil {
		t.Fatal(err)
	}
	cfgB, releaseB, err := srv.Register("run-b")
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
