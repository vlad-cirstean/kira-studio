package repomap

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// newConformanceServer builds a real Server over a seeded codeindex.Store (the same ReplaceFile
// seeding C2's own tests use, §11.3) without a real git repository — resolvedRepo is supplied
// directly rather than discovered, since this test is about the tool/registration surface, not
// repository discovery (locator_test.go and repo.go's own callers cover that separately).
func newConformanceServer(t *testing.T) *Server {
	t.Helper()
	home := t.TempDir()
	root := t.TempDir()
	store := codeindex.OpenStoreAt(home)
	t.Cleanup(func() { _ = store.Close() })

	if err := store.ReplaceFile(context.Background(), codeindex.FileWrite{
		RepoID: testRepoID, Path: "main.go", Language: "go",
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
		Symbols:    []codeparse.Symbol{mkSym("function", "Main", 0, 0, 20, 5)},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	resolved := resolvedRepo{repoID: testRepoID, root: root, gitPath: "", runner: gitclient.NewExecRunner()}
	srv, err := newServer(context.Background(), Config{
		Token: func(repoID string) (mcpauth.Record, string, bool, error) {
			plain, rec, _, err := mcpauth.LoadOrMint(mcpauth.Path(home, mcpauth.Slug(repoID)))
			return rec, plain, true, err
		},
	}, home, store, resolved)
	if err != nil {
		t.Fatalf("newServer: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

// TestConformanceListToolsAndCallEach is §11.3's own smoke test: a real client against a real
// server over mcp.NewInMemoryTransports(), guarding the thing a compiler cannot — a schema the SDK
// rejects at registration, or a renamed tool. Not per-tool coverage (render.go/tools.go's own
// clamping and rendering earn nothing per §11's stated bar).
func TestConformanceListToolsAndCallEach(t *testing.T) {
	srv := newConformanceServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientTransport, serverTransport := mcp.NewInMemoryTransports()

	serverSession, err := srv.mcp.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("server Connect: %v", err)
	}
	defer serverSession.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0.0.0"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client Connect: %v", err)
	}
	defer clientSession.Close()

	tools, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	want := map[string]bool{
		"find_definition": false, "find_references": false, "find_implementations": false,
		"search_symbols": false, "search_files": false, "outline_file": false,
	}
	for _, tool := range tools.Tools {
		if _, ok := want[tool.Name]; !ok {
			t.Errorf("unexpected tool advertised: %s", tool.Name)
			continue
		}
		want[tool.Name] = true
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("tool not advertised: %s", name)
		}
	}
	if len(tools.Tools) != len(want) {
		t.Errorf("ListTools returned %d tools, want exactly %d", len(tools.Tools), len(want))
	}

	calls := []struct {
		name string
		args map[string]any
	}{
		{"find_definition", map[string]any{"symbol": "Main"}},
		{"find_references", map[string]any{"symbol": "Main"}},
		{"find_implementations", map[string]any{"symbol": "Main"}},
		{"search_symbols", map[string]any{"query": "Main"}},
		{"search_files", map[string]any{"query": "main"}},
		{"outline_file", map[string]any{"file": "main.go"}},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			res, err := clientSession.CallTool(ctx, &mcp.CallToolParams{Name: c.name, Arguments: c.args})
			if err != nil {
				t.Fatalf("CallTool(%s): %v", c.name, err)
			}
			text := ""
			if len(res.Content) > 0 {
				if tc, ok := res.Content[0].(*mcp.TextContent); ok {
					text = tc.Text
				}
			}
			if res.IsError {
				t.Fatalf("CallTool(%s) returned IsError: %s", c.name, text)
			}
			if c.name == "find_definition" {
				// root is a t.TempDir() with no main.go on disk (the seeded row is metadata
				// only) — an exact reproduction of C8 plan D5's missing-file case. Pin it
				// explicitly rather than let it pass silently: "a deleted file must not turn a
				// navigation answer into an error" is the whole of D5.
				if !strings.Contains(text, "[no source: file not found]") {
					t.Errorf("find_definition response missing D5's safe-failure note, got: %s", text)
				}
			}
		})
	}
}
