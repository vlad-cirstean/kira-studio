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

// newConformanceServer builds a real Server (with one repository already Attach'd) over a seeded
// codeindex.Store (the same ReplaceFile seeding C2's own tests use, §11.3) without a real git
// repository — Attach is given a resolved identity directly rather than discovered, since this test
// is about the tool/registration surface, not repository discovery (locator_test.go and repo.go's
// own callers cover that separately).
func newConformanceServer(t *testing.T) *Server {
	t.Helper()
	home := t.TempDir()
	root := t.TempDir()

	seedStore := codeindex.OpenStoreAt(home)
	t.Cleanup(func() { _ = seedStore.Close() })
	if err := seedStore.ReplaceFile(context.Background(), codeindex.FileWrite{
		RepoID: testRepoID, Path: "main.go", Language: "go",
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
		Symbols:    []codeparse.Symbol{mkSym("function", "Main", 0, 0, 20, 5)},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	plain, rec, _, err := mcpauth.LoadOrMint(mcpauth.Path(home, mcpauth.Slug(testRepoID)))
	if err != nil {
		t.Fatalf("LoadOrMint: %v", err)
	}
	srv, err := New(Config{Home: home, Token: rec, TokenPlain: plain})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	if _, err := srv.Attach(RepoSpec{
		Key: "conformance", RepoID: testRepoID, Root: root, GitPath: "", Runner: gitclient.NewExecRunner(),
	}); err != nil {
		t.Fatalf("Attach: %v", err)
	}
	return srv
}

// TestFindDefinitionGoTypeSymbolOnly is the dogfooding-log regression (C7): find_definition called
// with only {"symbol": "<a Go type>"} — no file — must resolve to that type's own declaration, not
// fall into "no definitions found for \"\"". Root cause: Go's tags.scm double-captures a type
// declaration's own name as both a definition.type symbol row and a spurious self-referencing
// reference.type row at the identical span (codegraph's isSelfSite doc comment names the same
// quirk); locate()'s own search_symbols-derived Point then lands on that shared span, and
// resolveHit used to pick the reference first, so DefinitionOf found nothing. Regression-guards the
// resolveHit priority fix in internal/codegraph/position.go — see that package's own
// TestResolveHitSymbolWinsOverColocatedReference/TestDefinitionOfGoTypeSelfCapture for the same bug
// at the codegraph layer.
func TestFindDefinitionGoTypeSymbolOnly(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	store := codeindex.OpenStoreAt(home)
	t.Cleanup(func() { _ = store.Close() })

	// "type grpcCoalescer struct{...}" at row 0: the symbol's own name spans bytes [5,18); Go's own
	// tags.scm also emits a reference row at that identical span (the blanket @reference.type
	// capture on type_identifier, which also matches type_spec's own name field).
	if err := store.ReplaceFile(context.Background(), codeindex.FileWrite{
		RepoID: testRepoID, Path: "grpc.go", Language: "go",
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
		Symbols:    []codeparse.Symbol{mkSym("type", "grpcCoalescer", 0, 0, 30, 5)},
		References: []codeparse.Reference{mkRef("type", "grpcCoalescer", 0, 5, 18, 5)},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv, err := New(Config{Home: home})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	if _, err := srv.Attach(RepoSpec{
		Key: "grpc", RepoID: testRepoID, Root: root, GitPath: "", Runner: gitclient.NewExecRunner(),
	}); err != nil {
		t.Fatalf("Attach: %v", err)
	}

	res, _, err := srv.findDefinition(context.Background(), nil, findDefinitionArgs{
		locatorFields: locatorFields{Symbol: "grpcCoalescer"},
	})
	if err != nil {
		t.Fatalf("findDefinition: %v", err)
	}
	text := ""
	if len(res.Content) > 0 {
		if tc, ok := res.Content[0].(*mcp.TextContent); ok {
			text = tc.Text
		}
	}
	if res.IsError {
		t.Fatalf("findDefinition returned IsError: %s", text)
	}
	if strings.Contains(text, `no definitions found for ""`) {
		t.Fatalf("regressed to the empty-string bug: %s", text)
	}
	if !strings.Contains(text, `1 definition for "grpcCoalescer"`) || !strings.Contains(text, "type grpcCoalescer") {
		t.Fatalf("want a resolved definition for grpcCoalescer, got: %s", text)
	}
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
		"search_symbols": false, "search_files": false, "outline_file": false, "read_symbol": false,
		"list_repos": false,
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
		{"read_symbol", map[string]any{"symbol": "Main"}},
		{"list_repos", map[string]any{}},
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
