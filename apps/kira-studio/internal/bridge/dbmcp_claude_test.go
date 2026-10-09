package bridge_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/dbmcp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcfixture"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
)

type nopEmitter struct{}

func (nopEmitter) Emit(string, any)           {}
func (nopEmitter) EmitTo(string, string, any) {}
func (nopEmitter) EmitFocused(string, any)    {}

var _ appevent.Emitter = nopEmitter{}

// claudeConfigFiles is the user's Claude Code configuration under a fake HOME, as bytes.
func claudeConfigFiles(t *testing.T, home string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, rel := range []string{".claude.json", ".claude/settings.json", ".claude/settings.local.json"} {
		raw, err := os.ReadFile(filepath.Join(home, rel))
		if err == nil {
			out[rel] = string(raw)
		}
	}
	return out
}

func writeTestFile(t *testing.T, path, body string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

// TestDbMcpLeavesClaudeConfig runs the Database MCP pane's whole flow against a fake HOME and a
// fake claude that dirties ~/.claude.json on any `mcp` call: enabling, reading status, regenerating
// and disabling must leave the user's Claude Code configuration alone.
func TestDbMcpLeavesClaudeConfig(t *testing.T) {
	app := ipcfixture.NewApp(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	bin := t.TempDir()
	writeTestFile(t, filepath.Join(bin, "claude"), "#!/bin/sh\nif [ \"$1\" = mcp ]; then printf x >> \"$HOME/.claude.json\"; fi\n", 0o755)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	writeTestFile(t, filepath.Join(home, ".claude", "settings.json"), `{"permissions":{"allow":["Bash(git status)"]}}`+"\n", 0o644)
	writeTestFile(t, filepath.Join(home, ".claude.json"), `{"mcpServers":{"mine":{"type":"stdio","command":"/usr/bin/mine"}}}`+"\n", 0o644)
	before := claudeConfigFiles(t, home)

	deps := appcore.Deps{
		Repos: app.Repos, Connections: app.Connections, Tree: app.Tree, Router: app.Router,
		Events: nopEmitter{}, MaskRules: app.MaskRulesSvc.Deps.MaskRules,
	}
	svc := bridge.NewDbMcpService(deps, mcpinstall.New(mcpinstall.Deps{}), dbmcp.NewApprovalBroker(time.Now))

	st, err := svc.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !st.Running {
		t.Skipf("port 8766 in use: %s", st.Error)
	}
	t.Cleanup(func() { bridge.StopDbMcp(svc) })
	endpoint := filepath.Join(os.Getenv("KIRA_HOME"), "mcp-db-endpoint.json")
	if st := svc.Status(); !st.ClaudeAvailable {
		t.Fatalf("Status = %+v, want claude found", st)
	}
	svc.InstallClaudeCode(context.Background())
	svc.Regenerate()
	assertUnchanged := func(flow string) {
		t.Helper()
		after := claudeConfigFiles(t, home)
		for k, v := range before {
			if after[k] != v {
				t.Fatalf("DB MCP flow %s changed Claude Code config: %s", flow, k)
			}
		}
		for k := range after {
			if _, ok := before[k]; !ok {
				t.Fatalf("DB MCP flow %s created Claude Code config: %s", flow, k)
			}
		}
	}
	assertUnchanged("enable")

	raw, err := os.ReadFile(endpoint)
	if err != nil || !strings.Contains(string(raw), "127.0.0.1:8766/mcp") {
		t.Fatalf("endpoint file while running = %q, %v, want the live URL", raw, err)
	}

	if _, err := svc.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	assertUnchanged("disable")
	if _, err := os.Stat(endpoint); !os.IsNotExist(err) {
		t.Fatalf("endpoint file after disable: %v, want removed", err)
	}
}
