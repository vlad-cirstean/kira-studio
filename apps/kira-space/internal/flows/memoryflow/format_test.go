package memoryflow_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/memfmt"
)

// gitIn runs git in dir; a failure returns the combined output.
func gitIn(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func mustGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := gitIn(dir, args...)
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return out
}

func writeFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Contract memory-settings. UI half: settings-memory.spec.ts "contract: comment check shows the
// install commands".
func TestCommentCheckHook(t *testing.T) {
	app := flowharness.New(t)
	cc := app.W.Memory.CommentCheck()
	exe := flowharness.Replace(cc.Executable, "<bin>/kira-space")
	app.Contract(t, "memory-settings", "MemoryService.CommentCheck", cc, exe)
	if !filepath.IsAbs(cc.Executable) || !strings.Contains(cc.InstallCommand, "memory-check --install-hook") ||
		!strings.Contains(cc.HookLine, "memory-check --staged") || !strings.Contains(cc.InstallCommand, cc.Executable) {
		t.Fatalf("CommentCheck = %+v, want an absolute executable in both commands", cc)
	}

	repo := t.TempDir()
	mustGit(t, repo, "init", "-q")
	install := exec.Command(cc.Executable, "memory-check", "--install-hook")
	install.Dir = repo
	if out, err := install.CombinedOutput(); err != nil {
		t.Fatalf("install-hook: %v\n%s", err, out)
	}
	hook, err := os.ReadFile(filepath.Join(repo, ".git", "hooks", "pre-commit"))
	if err != nil || !strings.Contains(string(hook), "# kira-memory-check") || !strings.Contains(string(hook), "memory-check --staged") {
		t.Fatalf("hook = %q, %v, want the marked pre-commit script", hook, err)
	}

	writeFile(t, repo, "bad.go", "package bad\n// km_7h3kq9x2mfa4 orphan line\n")
	mustGit(t, repo, "add", "bad.go")
	out, err := gitIn(repo, "commit", "-q", "-m", "bad")
	if err == nil || !strings.Contains(out, "bad.go:2: fact line without kira-memory header") {
		t.Fatalf("commit of an orphan km_ line = %v\n%s, want it blocked with path:line", err, out)
	}

	// The retired P273 lines are flagged, not read.
	writeFile(t, repo, "bad.go", "package bad\n// kira-memory origin=user scope=company\n// km_7h3kq9x2mfa4 fact: Port is 9090.\n// km_7h3kq9x2mfa4 reason: Manifest says so.\n")
	mustGit(t, repo, "add", "bad.go")
	out, err = gitIn(repo, "commit", "-q", "-m", "v1")
	if err == nil || !strings.Contains(out, "bad.go:3: ") || !strings.Contains(out, "retired P273 format") {
		t.Fatalf("commit of P273 lines = %v\n%s, want it blocked as retired", err, out)
	}

	writeFile(t, repo, "bad.go", "package bad\n// legacy comment mentioning km_7h3kq9x2mfa4 mid-sentence\n"+
		"// kira-memory origin=user scope=company\n// km_7h3kq9x2mfa4 Port is 9090.\n//   Manifest says so.\n")
	mustGit(t, repo, "add", "bad.go")
	if out, err := gitIn(repo, "commit", "-q", "-m", "good"); err != nil {
		t.Fatalf("commit of a valid block: %v\n%s", err, out)
	}

	foreign := t.TempDir()
	mustGit(t, foreign, "init", "-q")
	mine := filepath.Join(foreign, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(mine, []byte("#!/bin/sh\necho mine\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	clash := exec.Command(cc.Executable, "memory-check", "--install-hook")
	clash.Dir = foreign
	clashOut, err := clash.CombinedOutput()
	if err == nil || !strings.Contains(string(clashOut), cc.HookLine) {
		t.Fatalf("install over a foreign hook = %v\n%s, want exit 1 printing the hook line", err, clashOut)
	}
	if kept, _ := os.ReadFile(mine); string(kept) != "#!/bin/sh\necho mine\n" {
		t.Fatalf("foreign hook was rewritten: %q", kept)
	}
}

// memoryMCP connects a client to a real memory-mcp subprocess over the app's memory home.
func memoryMCP(t *testing.T, app *flowharness.App) *mcp.ClientSession {
	t.Helper()
	cmd := exec.Command(app.W.Memory.McpStatus().Executable, "memory-mcp")
	cmd.Dir = app.Work
	cmd.Env = append(os.Environ(), "KIRA_MEMORY_HOME="+app.MemoryHome, "CLAUDE_CODE_SESSION_ID="+flowSession)
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "flow", Version: "1"}, nil).Connect(ctx, &mcp.CommandTransport{Command: cmd}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

type storeOut struct {
	Status   string
	Comment  string
	Prepared []struct{ ID, Action string }
}

func callStore(t *testing.T, cs *mcp.ClientSession, args map[string]any) (storeOut, string) {
	t.Helper()
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "store_memory", Arguments: args})
	if err != nil || res.IsError {
		t.Fatalf("store_memory: %v %+v", err, res)
	}
	var out storeOut
	raw, _ := json.Marshal(res.StructuredContent)
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out, res.Content[0].(*mcp.TextContent).Text
}

func TestMcpPrepareComment(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	cs := memoryMCP(t, app)
	items := []map[string]string{
		{"fact": "billing runs postgres", "reason": "migration notes", "origin": "user", "scope": "personal"},
		{"fact": "staging deploys at 09:00", "reason": "release calendar", "origin": "user", "scope": "personal"},
	}
	args := map[string]any{"items": items, "asComment": "internal/billing/api.go"}

	mark := app.Events.Mark()
	out, text := callStore(t, cs, args)
	blocks, problems := memfmt.ParseComments("internal/billing/api.go", []byte(out.Comment))
	if out.Status != "prepared" || len(problems) != 0 || len(blocks) != 1 || len(blocks[0].Facts) != 2 {
		t.Fatalf("prepared = %+v, problems %v, blocks %+v, want one block of two facts", out, problems, blocks)
	}
	for _, f := range blocks[0].Facts {
		if !factID(f.ID) {
			t.Fatalf("fact id %q is not a km_ id", f.ID)
		}
	}
	if !strings.HasPrefix(text, "Nothing was stored.") || !strings.HasSuffix(text, "\n\n"+out.Comment) {
		t.Fatalf("text = %q, want the prepared line, a blank line and the comment", text)
	}
	if recent, err := app.W.Memory.Recent(ctx); err != nil || len(recent) != 0 {
		t.Fatalf("Recent = %+v, %v, want nothing stored", recent, err)
	}
	if ev := app.Events.Since(mark, bridge.ChannelMemoryChanged); len(ev) != 0 {
		t.Fatalf("prepare emitted %d memory changed events, want none", len(ev))
	}

	if res, err := app.W.Memory.Store(ctx, twoItemsArgs()); err != nil || res.Status != "stored" {
		t.Fatalf("Store = %+v, %v", res, err)
	}
	stored, err := app.W.Memory.Recent(ctx)
	if err != nil || len(stored) != 2 {
		t.Fatalf("Recent = %+v, %v", stored, err)
	}
	again, _ := callStore(t, cs, args)
	ids := map[string]bool{}
	for _, p := range again.Prepared {
		ids[p.ID] = p.Action == memory.ActionNoop
	}
	for _, m := range stored {
		if !ids[m.LineageID] {
			t.Fatalf("prepared = %+v, want a noop carrying stored fact id %s", again.Prepared, m.LineageID)
		}
		if !strings.Contains(again.Comment, m.LineageID+" ") {
			t.Fatalf("comment lacks stored id %s:\n%s", m.LineageID, again.Comment)
		}
	}
}

func TestMcpSearchTextFormat(t *testing.T) {
	app := flowharness.New(t)
	gate(t, app, "gate-accept.json")
	if _, err := app.W.Memory.Store(ctx, twoItemsArgs()); err != nil {
		t.Fatal(err)
	}
	cs := memoryMCP(t, app)
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "search_memories", Arguments: map[string]any{"query": "postgresql"}})
	if err != nil || res.IsError {
		t.Fatalf("search_memories: %v %+v", err, res)
	}
	line := regexp.MustCompile(`^` + memfmt.FactID + ` (fact|reason|meta): `)
	n := 0
	for _, l := range strings.Split(res.Content[0].(*mcp.TextContent).Text, "\n") {
		if l == "" || strings.HasPrefix(l, "Note: ") {
			continue
		}
		n++
		if !line.MatchString(l) {
			t.Fatalf("line %q is not '<km_ id> fact|reason|meta: ...'", l)
		}
	}
	if n != 3 {
		t.Fatalf("search text holds %d lines, want fact, reason and meta", n)
	}
}
