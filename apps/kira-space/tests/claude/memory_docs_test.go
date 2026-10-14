package claude

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
)

// TestMemoryMcpFollowsDocs has the real claude use the kira-memory server from goal-only prompts,
// so the server instructions and tool docs alone must steer it: each stored item carries a reason,
// origin and scope, a docs folder goes by path with no read of its content, and a request to
// condense a file goes to distill by path, again with no read of the file.
func TestMemoryMcpFollowsDocs(t *testing.T) {
	app := newRealApp(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	repo := filepath.Join(app.Work, "billing")
	for _, args := range [][]string{
		{"init", "-q", repo},
		{"-C", repo, "remote", "add", "origin", "https://github.com/acme/billing.git"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	cfg := filepath.Join(t.TempDir(), "mcp.json")
	writeFile(t, cfg, string(mustRaw(map[string]any{"mcpServers": map[string]any{
		memoryServer: map[string]any{"command": exe, "args": []string{"memory-mcp"}, "env": map[string]string{
			"KIRA_MEMORY_HOME": app.MemoryHome, "KIRA_SPACE_HOME": app.SpaceHome, "HOME": app.Home, "PATH": os.Getenv("PATH"),
		}},
	}})))
	var memTools []string
	for _, n := range []string{"store_memory", "search_memories", "memory_history", "memory_context", "ingest_files", "ingest_status", "distill"} {
		memTools = append(memTools, "mcp__"+memoryServer+"__"+n)
	}

	t.Run("store", func(t *testing.T) {
		out, _ := app.claudeP(t, repo, nil,
			"Remember for the team: we deploy billing-api with Helm, because ops standardised on Helm charts in 2025. Use the kira-memory server.",
			"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", strings.Join(memTools, ","),
			"--output-format", "stream-json", "--verbose")
		uses := toolUses(parseStream(out), "mcp__"+memoryServer+"__store_memory")
		if len(uses) == 0 {
			t.Fatalf("no store_memory tool use in the stream:\n%s", tail(out, 1500))
		}
		var in struct {
			Items []struct {
				Reason string `json:"reason"`
				Origin string `json:"origin"`
				Scope  string `json:"scope"`
			} `json:"items"`
		}
		if err := json.Unmarshal(uses[0].Input, &in); err != nil || len(in.Items) == 0 {
			t.Fatalf("store_memory input = %s (%v), want at least one item", uses[0].Input, err)
		}
		for _, it := range in.Items {
			if strings.TrimSpace(it.Reason) == "" || it.Origin != "user" ||
				(it.Scope != "company" && it.Scope != "project" && it.Scope != "personal") {
				t.Errorf("item %+v, want a reason, origin user and a known scope", it)
			}
		}
	})

	t.Run("files", func(t *testing.T) {
		docs := filepath.Join(repo, "docs")
		deploy := filepath.Join(docs, "deploy.md")
		writeFile(t, deploy, "# Deploy\n\nbilling-api ships through Helm charts; ops owns the chart repository.\n")
		tools := strings.Join(append(append([]string{}, memTools...), "Read", "Glob", "Grep"), ",")
		out, _ := app.claudeP(t, repo, nil,
			"Add the docs in "+docs+" to long-term memory.",
			"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", tools,
			"--output-format", "stream-json", "--verbose")
		msgs := parseStream(out)
		for _, m := range msgs {
			if m.Type != "assistant" {
				continue
			}
			for _, b := range blocks(m) {
				if b.Type == "tool_use" {
					t.Logf("tool use %s %s", b.Name, tail(string(b.Input), 200))
				}
			}
		}
		uses := toolUses(msgs, "mcp__"+memoryServer+"__ingest_files")
		if len(uses) == 0 {
			t.Fatalf("no ingest_files tool use in the stream:\n%s", tail(out, 1500))
		}
		var in struct {
			Paths   []string `json:"paths"`
			Project string   `json:"project"`
		}
		if err := json.Unmarshal(uses[0].Input, &in); err != nil {
			t.Fatal(err)
		}
		if in.Project != "" && in.Project != "github.com/acme/billing" {
			t.Errorf("ingest_files project = %q, want it omitted or github.com/acme/billing", in.Project)
		}
		var byPath bool
		for _, p := range in.Paths {
			byPath = byPath || p == docs || p == deploy
		}
		if !byPath {
			t.Errorf("ingest_files paths = %v, want %s or %s", in.Paths, docs, deploy)
		}
		for _, tool := range []string{"Read", "Grep"} {
			for _, u := range toolUses(msgs, tool) {
				if strings.Contains(string(u.Input), docs) {
					t.Errorf("claude used %s on the docs itself: %s", tool, u.Input)
				}
			}
		}
		// Cancel the job so the test spends nothing on extraction.
		jobs, err := app.W.MemoryImport.Jobs()
		if err != nil {
			t.Fatal(err)
		}
		for _, j := range jobs {
			if err := app.W.MemoryImport.Cancel(bridge.MemoryImportJobArgs{ID: j.ID}); err != nil {
				t.Logf("cancel job %s: %v", j.ID, err)
			}
		}
	})

	t.Run("distill", func(t *testing.T) {
		notes := filepath.Join(repo, "docs", "runbook.md")
		writeFile(t, notes, "# Runbook\n\nbilling-api restarts take about 40 seconds. Restart workers first, never the database, because open invoices would lock.\n")
		tools := strings.Join(append(append([]string{}, memTools...), "Read", "Glob", "Grep"), ",")
		out, _ := app.claudeP(t, repo, nil,
			"Condense "+notes+" into short lines; store nothing.",
			"--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", tools,
			"--output-format", "stream-json", "--verbose")
		msgs := parseStream(out)
		uses := toolUses(msgs, "mcp__"+memoryServer+"__distill")
		if len(uses) == 0 {
			t.Fatalf("no distill tool use in the stream:\n%s", tail(out, 1500))
		}
		var in struct {
			Path string `json:"path"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(uses[0].Input, &in); err != nil {
			t.Fatal(err)
		}
		if in.Path != notes || in.Text != "" {
			t.Errorf("distill input = %s, want path %s and no text", uses[0].Input, notes)
		}
		if got := toolUses(msgs, "mcp__"+memoryServer+"__store_memory"); len(got) != 0 {
			t.Errorf("claude stored memory in a distill request: %s", got[0].Input)
		}
		for _, tool := range []string{"Read", "Grep"} {
			for _, u := range toolUses(msgs, tool) {
				if strings.Contains(string(u.Input), notes) {
					t.Errorf("claude used %s on the file itself: %s", tool, u.Input)
				}
			}
		}
	})
}
