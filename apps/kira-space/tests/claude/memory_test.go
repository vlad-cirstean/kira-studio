package claude

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const memoryServer = "kira-memory"

// TestMemoryMcpThroughClaude points the real claude at this test binary re-executed as the
// memory-mcp stdio server and has it call search_memories.
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
