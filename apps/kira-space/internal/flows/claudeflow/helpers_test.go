package claudeflow_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/testx"
)

var ctx = context.Background()

const (
	waitFor = 20 * time.Second
	window  = "w-claude"
	// emulateArg switches the test binary into the claude mcp emulation (TestMain).
	emulateArg = "claudecfg-emulate"
)

// fakeCLI puts a claude on PATH that emulates `claude mcp add-json|remove --scope user` on the
// user's .claude.json and hands everything else to the harness's fake agent. The real CLI is
// never run: it rewrites ~/.claude.json on every invocation (counters, project trust).
func fakeCLI(t *testing.T, app *flowharness.App) {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(app.BinDir, "claude")
	realDir := filepath.Join(app.BinDir, "real")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	realClaude := filepath.Join(realDir, "claude")
	if err := os.Rename(link, realClaude); err != nil {
		t.Fatal(err)
	}
	script := fmt.Sprintf("#!/bin/sh\ncase \"$1\" in\n  mcp) exec %s %s \"$@\" ;;\n  *) exec %s \"$@\" ;;\nesac\n",
		shQuote(self), emulateArg, shQuote(realClaude))
	if err := os.WriteFile(link, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// emulateMcp plays `claude mcp ...` on $CLAUDE_CONFIG_DIR/.claude.json or $HOME/.claude.json.
func emulateMcp(args []string) int {
	dir := os.Getenv("KIRA_FAKE_DIR")
	if dir != "" {
		n := 0
		if raw, err := os.ReadFile(filepath.Join(dir, "cfg.count")); err == nil {
			_, _ = fmt.Sscanf(string(raw), "%d", &n)
		}
		n++
		_ = os.WriteFile(filepath.Join(dir, "cfg.count"), []byte(fmt.Sprint(n)), 0o644)
		_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("cfg-%d.args", n)), []byte(strings.Join(args, "\n")), 0o644)
	}
	path := filepath.Join(os.Getenv("HOME"), ".claude.json")
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		path = filepath.Join(d, ".claude.json")
	}
	doc := map[string]any{}
	if raw, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(raw, &doc); err != nil {
			fmt.Fprintln(os.Stderr, "emulate:", err)
			return 2
		}
	}
	servers, _ := doc["mcpServers"].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
	}
	switch {
	case len(args) == 6 && args[1] == "add-json" && args[2] == "--scope" && args[3] == "user":
		var v any
		if err := json.Unmarshal([]byte(args[5]), &v); err != nil {
			fmt.Fprintln(os.Stderr, "emulate: bad json:", err)
			return 1
		}
		servers[args[4]] = v
	case len(args) == 5 && args[1] == "remove" && args[2] == "--scope" && args[3] == "user":
		if _, ok := servers[args[4]]; !ok {
			fmt.Fprintf(os.Stderr, "No MCP server named %q in user scope\n", args[4])
			return 1
		}
		delete(servers, args[4])
	default:
		fmt.Fprintln(os.Stderr, "emulate: unsupported:", strings.Join(args, " "))
		return 2
	}
	doc["mcpServers"] = servers
	out, _ := json.MarshalIndent(doc, "", "  ")
	if err := os.WriteFile(path, out, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, "emulate:", err)
		return 2
	}
	return 0
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// seedClaudeConfig writes the user's own Claude Code configuration, global and per project.
func seedClaudeConfig(t *testing.T, home, repo string) {
	t.Helper()
	writeFile(t, filepath.Join(home, ".claude", "settings.json"),
		`{"permissions":{"allow":["Bash(git status)"]},"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}`+"\n")
	writeFile(t, filepath.Join(home, ".claude", "settings.local.json"), `{"model":"opus"}`+"\n")
	writeFile(t, filepath.Join(home, ".claude.json"),
		`{"numStartups":3,"mcpServers":{"mine":{"type":"stdio","command":"/usr/bin/mine","args":["serve"]}},"projects":{"/x":{"allowedTools":[]}}}`+"\n")
	writeFile(t, filepath.Join(repo, ".claude", "settings.json"), `{"permissions":{"deny":["Read(.env)"]}}`+"\n")
	writeFile(t, filepath.Join(repo, ".claude", "settings.local.json"), `{"enableAllProjectMcpServers":true}`+"\n")
	writeFile(t, filepath.Join(repo, ".mcp.json"), `{"mcpServers":{"proj":{"type":"stdio","command":"/usr/bin/proj"}}}`+"\n")
	writeFile(t, filepath.Join(repo, "CLAUDE.md"), "# project rules\n")
}

// snapshot maps every Claude Code configuration file to its mode and digest.
func snapshot(t *testing.T, home, repo string) map[string]string {
	t.Helper()
	out := map[string]string{}
	add := func(root, rel string) {
		abs := filepath.Join(root, rel)
		_ = filepath.WalkDir(abs, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			raw, rerr := os.ReadFile(p)
			info, serr := d.Info()
			if rerr != nil || serr != nil {
				return nil
			}
			sum := sha256.Sum256(raw)
			label, _ := filepath.Rel(root, p)
			out[filepath.Base(root)+"/"+label] = fmt.Sprintf("%v sha256 %s", info.Mode().Perm(), hex.EncodeToString(sum[:8]))
			return nil
		})
	}
	add(home, ".claude")
	add(home, ".claude.json")
	add(repo, ".claude")
	add(repo, ".mcp.json")
	add(repo, "CLAUDE.md")
	return out
}

// diff names every path that differs between two snapshots.
func diff(before, after map[string]string) []string {
	var d []string
	for k, v := range after {
		if old, ok := before[k]; !ok {
			d = append(d, k+" created")
		} else if old != v {
			d = append(d, fmt.Sprintf("%s changed (%s to %s)", k, old, v))
		}
	}
	for k := range before {
		if _, ok := after[k]; !ok {
			d = append(d, k+" removed")
		}
	}
	sort.Strings(d)
	return d
}

func claude(app *flowharness.App, byRepo map[string][]fakeagent.Action) {
	app.Scenario(fakeagent.Scenario{Claude: byRepo})
}

// agentArgv returns the argv of the next agent launch open starts: the first new fake claude
// record, which is not the mcp emulation's.
func agentArgv(t *testing.T, app *flowharness.App, open func()) []string {
	t.Helper()
	known := map[string]bool{}
	list := func() []string {
		files, _ := filepath.Glob(filepath.Join(app.FakeDir, "*.args"))
		var out []string
		for _, f := range files {
			if !strings.HasPrefix(filepath.Base(f), "cfg-") {
				out = append(out, f)
			}
		}
		return out
	}
	for _, f := range list() {
		known[f] = true
	}
	open()
	var argv []string
	testx.WaitUntil(t, waitFor, func() bool {
		for _, f := range list() {
			if known[f] {
				continue
			}
			raw, err := os.ReadFile(f)
			if err != nil || len(raw) == 0 {
				continue
			}
			argv = strings.Split(string(raw), "\n")
			return true
		}
		return false
	})
	return argv
}

// flagValues returns every value following flag in argv.
func flagValues(argv []string, flag string) []string {
	var out []string
	for i, a := range argv {
		if a == flag && i+1 < len(argv) {
			out = append(out, argv[i+1])
		}
	}
	return out
}

func openAgent(t *testing.T, app *flowharness.App, id, cwd string) {
	t.Helper()
	if _, err := app.W.Terminal.Open(terminal.OpenArgs{
		TerminalID: id, WindowKey: window, Cwd: cwd, Cols: 100, Rows: 30,
		Command: "claude", LaunchKind: terminal.LaunchKindClaudeCode,
	}); err != nil {
		t.Fatalf("Terminal.Open %s: %v", id, err)
	}
}

func importRepo(t *testing.T, app *flowharness.App, dir string) model.CodeRepo {
	t.Helper()
	rec, err := app.W.CodeWorkspace.ImportRepo(ctx, bridge.CodeWorkspaceImportArgs{Path: dir})
	if err != nil {
		t.Fatalf("ImportRepo %s: %v", dir, err)
	}
	return rec
}

func saveWorkflow(t *testing.T, app *flowharness.App, id, yaml string) {
	t.Helper()
	entry, err := app.W.AdeTask.SaveWorkflowYaml(ctx, adewire.SaveWorkflowYamlArgs{FileName: id + ".yaml", Yaml: yaml})
	if err != nil || entry.Error != nil {
		t.Fatalf("SaveWorkflowYaml: %v %+v", err, entry.Error)
	}
}
