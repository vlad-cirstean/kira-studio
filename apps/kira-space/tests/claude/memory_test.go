package claude

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

const memoryServer = "kira-memory"

// TestMemoryMcpThroughClaude points the real claude at this test binary re-executed as the
// memory-mcp stdio server and has it call search_memories, then store_memory and memory_context.
// The second run starts in a git repository whose origin remote names the project key.
func TestMemoryMcpThroughClaude(t *testing.T) {
	app := newRealApp(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(t.TempDir(), "mcp.json")
	writeFile(t, cfg, string(mustRaw(map[string]any{"mcpServers": map[string]any{
		memoryServer: map[string]any{"command": exe, "args": []string{"memory-mcp"}, "env": map[string]string{"KIRA_MEMORY_HOME": app.MemoryHome}},
	}})))

	out, _ := app.claudeP(t, app.Work, nil,
		"Call the search_memories tool once with the query \"billing\", then reply with the word done.",
		"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", "mcp__"+memoryServer+"__search_memories",
		"--output-format", "stream-json", "--verbose")
	msgs := parseStream(out)
	uses := toolUses(msgs, "mcp__"+memoryServer+"__search_memories")
	if len(uses) == 0 {
		t.Fatalf("no search_memories tool use in the stream:\n%s", tail(out, 1500))
	}
	text, isErr, ok := toolResult(msgs, uses[0].ID)
	if !ok || isErr {
		t.Fatalf("search_memories result missing or an error (ok=%v, text=%q)", ok, text)
	}
	if !strings.Contains(text, "memories") {
		t.Fatalf("search_memories result = %q, want the server's JSON", text)
	}
	if res := resultMsg(t, msgs); res.IsError {
		t.Fatalf("claude run ended in error: %+v", res)
	}
	storeThroughClaude(t, app, cfg)
	asCommentThroughClaude(t, app, cfg)
}

// asCommentThroughClaude has claude call store_memory with asComment: the comment comes back,
// parses clean, and the store keeps the one fact the previous step wrote.
func asCommentThroughClaude(t *testing.T, app *realApp, cfg string) {
	t.Helper()
	out, _ := app.claudeP(t, app.Work, nil,
		"Call store_memory once with one item: fact \"The billing-api service listens on port 8080 in production.\", "+
			"reason \"Stated in the deployment manifest.\", origin agent, scope personal, and asComment \"go\". Reply with the word done.",
		"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", "mcp__"+memoryServer+"__store_memory",
		"--output-format", "stream-json", "--verbose")
	msgs := parseStream(out)
	uses := toolUses(msgs, "mcp__"+memoryServer+"__store_memory")
	if len(uses) == 0 {
		t.Fatalf("no store_memory tool use in the stream:\n%s", tail(out, 1500))
	}
	text, isErr, ok := toolResult(msgs, uses[0].ID)
	if !ok || isErr || !strings.HasPrefix(text, "Nothing was stored.") {
		t.Fatalf("store_memory asComment result = %q (ok=%v, err=%v), want the prepared line and a comment", text, ok, isErr)
	}
	_, comment, _ := strings.Cut(text, "\n\n")
	blocks, problems := memfmt.ParseComments("x.go", []byte(comment))
	if len(problems) != 0 || len(blocks) != 1 || len(blocks[0].Facts) != 1 {
		t.Fatalf("comment %q: blocks %+v, problems %v, want one clean block of one fact", comment, blocks, problems)
	}
	if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 1 {
		t.Fatalf("Recent = %+v, %v, want the store untouched", recent, err)
	}
}

// sessionID is the --session-id of the store run; the server records it when claude exports it.
const sessionID = "5f1c0f55-7a62-4a5b-9b52-0d6a2f0c1e11"

func storeThroughClaude(t *testing.T, app *realApp, cfg string) {
	t.Helper()
	repo := filepath.Join(app.Work, "billing")
	for _, args := range [][]string{
		{"init", "-q", repo},
		{"-C", repo, "remote", "add", "origin", "https://github.com/acme/billing.git"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	tools := "mcp__" + memoryServer + "__store_memory,mcp__" + memoryServer + "__memory_context"
	out, _ := app.claudeP(t, repo, nil,
		"Call store_memory once with one item: fact \"The billing-api service listens on port 8080 in production.\", "+
			"reason \"Stated in the deployment manifest.\", origin agent, scope project, and no project argument. "+
			"Then call memory_context with the fact id from the result. Reply with the word done.",
		"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", tools, "--session-id", sessionID,
		"--output-format", "stream-json", "--verbose")
	msgs := parseStream(out)
	for _, tool := range []string{"store_memory", "memory_context"} {
		uses := toolUses(msgs, "mcp__"+memoryServer+"__"+tool)
		if len(uses) == 0 {
			t.Fatalf("no %s tool use in the stream:\n%s", tool, tail(out, 1500))
		}
		if text, isErr, ok := toolResult(msgs, uses[0].ID); !ok || isErr {
			t.Fatalf("%s result missing or an error (ok=%v, text=%q)", tool, ok, text)
		}
	}
	recent, err := app.W.Memory.Recent(ctx)
	if err != nil || len(recent) != 1 {
		t.Fatalf("Recent = %+v, %v, want the stored fact", recent, err)
	}
	m := recent[0]
	if m.Origin != memory.OriginAgent || m.Scope != memory.ScopeProject || m.Project == nil || *m.Project != "github.com/acme/billing" {
		t.Fatalf("stored memory = %+v, want an agent fact in project github.com/acme/billing", m)
	}
	// Step 0 of P272 found CLAUDE_CODE_SESSION_ID exported to MCP servers and equal to --session-id.
	if m.SessionID == nil || *m.SessionID != sessionID {
		t.Fatalf("session = %v, want %s", m.SessionID, sessionID)
	}
	if c, err := app.W.Memory.Context(ctx, bridge.MemoryContextArgs{ID: m.LineageID}); err != nil || c.Memory.ID != m.ID {
		t.Fatalf("Context = %+v, %v, want the stored fact", c, err)
	}
}

// TestMemoryInstallRegisters runs the Connect dialog's install under the temp HOME and has the
// real claude list the server back.
func TestMemoryInstallRegisters(t *testing.T) {
	app := newRealApp(t)
	res := app.W.Memory.InstallClaudeCode(ctx)
	if res.Outcome != "installed" {
		t.Fatalf("InstallClaudeCode = %+v, want installed", res)
	}
	// Proves the install used the temp HOME. The real ~/.claude.json is not checked: other claude
	// processes rewrite it.
	raw, err := os.ReadFile(filepath.Join(app.Home, ".claude.json"))
	if err != nil || !strings.Contains(string(raw), memoryServer) {
		t.Fatalf("temp .claude.json lacks %s (err %v):\n%s", memoryServer, err, tail(string(raw), 600))
	}
	out, errOut, err := app.run(t, app.Work, nil, "mcp", "list")
	if err != nil {
		t.Fatalf("claude mcp list: %v\n%s", err, tail(out+errOut, 800))
	}
	if !strings.Contains(out, memoryServer) {
		t.Fatalf("claude mcp list lacks %s:\n%s", memoryServer, out)
	}
	t.Logf("claude mcp list:\n%s", out)
}
