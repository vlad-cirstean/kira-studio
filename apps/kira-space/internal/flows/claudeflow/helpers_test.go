package claudeflow_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/flowtest/fakeagent"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/testx"
)

var ctx = context.Background()

const (
	waitFor = 20 * time.Second
	window  = "w-claude"
)

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
