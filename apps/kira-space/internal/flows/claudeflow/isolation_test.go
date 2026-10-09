package claudeflow_test

import (
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness/fakeagent"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type sessionServer struct {
	Type          string   `json:"type"`
	Command       string   `json:"command"`
	Args          []string `json:"args"`
	URL           string   `json:"url"`
	HeadersHelper string   `json:"headersHelper"`
}

// sessionServers parses the session --mcp-config file named in argv.
func sessionServers(t *testing.T, argv []string) map[string]sessionServer {
	t.Helper()
	cfgs := flagValues(argv, "--mcp-config")
	if len(cfgs) == 0 {
		t.Fatalf("agent launch argv has no --mcp-config: %q", argv)
	}
	raw, err := os.ReadFile(cfgs[len(cfgs)-1])
	if err != nil {
		t.Fatalf("session mcp config: %v", err)
	}
	var doc struct {
		Servers map[string]sessionServer `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("session mcp config is not JSON: %v", err)
	}
	return doc.Servers
}

func TestClaudeConfigUntouched(t *testing.T) {
	app := flowharness.New(t)
	fakeCLI(t, app)
	repo := app.NewRepo("proj")
	repo.Commit("base", map[string]string{"a.txt": "a\n"})
	claude(app, map[string][]fakeagent.Action{"*": {{}}})
	seedClaudeConfig(t, app.Home, repo.Dir)
	before := snapshot(t, app.Home, repo.Dir)

	check := func(t *testing.T, flow string) {
		t.Helper()
		if d := diff(before, snapshot(t, app.Home, repo.Dir)); len(d) > 0 {
			t.Fatalf("%s changed Claude Code config: %s", flow, strings.Join(d, "; "))
		}
	}

	t.Run("memory_connect", func(t *testing.T) {
		if st := app.W.Memory.McpStatus(); !st.ClaudeAvailable {
			t.Fatalf("McpStatus = %+v, want claude found", st)
		}
		if l := app.W.Memory.ClaudeLegacy(); len(l.Entries) != 0 {
			t.Fatalf("ClaudeLegacy = %+v, want none in a clean config", l)
		}
		check(t, "memory_connect")
	})

	t.Run("terminal_agent_session", func(t *testing.T) {
		argv := agentArgv(t, app, func() { openAgent(t, app, "agent-1", repo.Dir) })
		settings := flagValues(argv, "--settings")
		if len(settings) != 1 || !filepath.IsAbs(settings[0]) {
			t.Fatalf("agent launch --settings = %q, want one absolute path", settings)
		}
		servers := sessionServers(t, argv)
		mem, ok := servers["kira-memory"]
		if !ok || mem.Type != "stdio" || !slices.Equal(mem.Args, []string{"memory-mcp"}) || !filepath.IsAbs(mem.Command) {
			t.Fatalf("session servers = %+v, want kira-memory stdio memory-mcp with an absolute command", servers)
		}
		if _, ok := servers["kira-db"]; ok {
			t.Fatalf("session servers = %+v, kira-db present without a running DB MCP", servers)
		}
		sess, err := mcp.NewClient(&mcp.Implementation{Name: "probe", Version: "1"}, nil).
			Connect(ctx, &mcp.CommandTransport{Command: exec.Command(mem.Command, mem.Args...)}, nil)
		if err != nil {
			t.Fatalf("connect to session kira-memory: %v", err)
		}
		defer sess.Close()
		res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "search_memories", Arguments: map[string]any{"query": "x"}})
		if err != nil || res.IsError {
			t.Fatalf("search_memories = %+v, %v", res, err)
		}
		check(t, "terminal_agent_session")
	})

	t.Run("terminal_agent_session_with_db", func(t *testing.T) {
		helper := filepath.Join(t.TempDir(), "mcp-header-helper.sh")
		writeFile(t, helper, "#!/bin/sh\n")
		if err := os.Chmod(helper, 0o700); err != nil {
			t.Fatal(err)
		}
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		url := "http://" + ln.Addr().String() + "/mcp"
		endpoint, _ := json.Marshal(map[string]string{"url": url, "headersHelper": helper})
		writeFile(t, filepath.Join(os.Getenv("KIRA_HOME"), "mcp-db-endpoint.json"), string(endpoint))

		argv := agentArgv(t, app, func() { openAgent(t, app, "agent-2", repo.Dir) })
		db, ok := sessionServers(t, argv)["kira-db"]
		if !ok || db.Type != "http" || db.URL != url || db.HeadersHelper != "'"+helper+"'" {
			t.Fatalf("session kira-db = %+v (present %v), want http %s with the quoted helper", db, ok, url)
		}

		_ = ln.Close()
		argv = agentArgv(t, app, func() { openAgent(t, app, "agent-3", repo.Dir) })
		if _, ok := sessionServers(t, argv)["kira-db"]; ok {
			t.Fatal("session has kira-db after the DB MCP port closed")
		}
		check(t, "terminal_agent_session_with_db")
	})

	t.Run("ade_session_start", func(t *testing.T) {
		rec := importRepo(t, app, repo.Dir)
		saveWorkflow(t, app, "flow", "id: flow\nname: Flow\nstages:\n  - id: work\n    name: Work\n    kind: user\n    status: In progress\n    session: true\n")
		task, err := app.W.AdeTask.CreateTask(ctx, adewire.CreateTaskArgs{Title: "Fix login", CodeRepoIDs: []string{rec.ID}, WorkflowID: "flow"})
		if err != nil {
			t.Fatal(err)
		}
		launch, err := app.W.AdeTask.LaunchStage(ctx, adewire.LaunchStageArgs{TaskID: task.ID})
		if err != nil {
			t.Fatal(err)
		}
		argv := agentArgv(t, app, func() {
			if _, err := app.W.Terminal.Open(terminal.OpenArgs{
				TerminalID: launch.TerminalID, WindowKey: window, Cwd: launch.Cwd, Cols: 100, Rows: 30,
				Command: launch.Command, LaunchKind: terminal.LaunchKindClaudeCode,
			}); err != nil {
				t.Fatal(err)
			}
		})
		if _, ok := sessionServers(t, argv)["kira-memory"]; !ok {
			t.Fatalf("ADE launch session config has no kira-memory: %q", argv)
		}
		if len(flagValues(argv, "--settings")) != 1 {
			t.Fatalf("ADE launch has no --settings: %q", argv)
		}
		check(t, "ade_session_start")
	})

	app.Restart()
	check(t, "app restart")
}
