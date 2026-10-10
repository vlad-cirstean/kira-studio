package dbmcpflow

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	_ "modernc.org/sqlite"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/testx"
)

var ctx = context.Background()

func ptr[T any](v T) *T { return &v }

var urlRe = regexp.MustCompile(`"url":"([^"]+)"`)

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

// fixture is an app with the MCP server on and one exposed SQLite connection: reads allowed,
// writes need approval, DDL denied.
type fixture struct {
	app    *flowharness.App
	url    string
	connID string
	dbPath string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := flowharness.New(t)
	dbPath := filepath.Join(t.TempDir(), "mcp.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"create table notes (id integer primary key, body text)",
		"insert into notes (body) values ('one'), ('two')",
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	conn, err := app.W.Connections.Create(connections.Input{ConnectionFields: model.ConnectionFields{
		Name: "notes db", Kind: "sqlite", Color: "teal", Mode: "fields", Database: ptr(dbPath), Options: map[string]any{},
		McpEnabled: true, McpDescription: "scratch notes", McpReadMode: "allow", McpWriteMode: "prompt", McpDdlMode: "deny",
	}})
	if err != nil {
		t.Fatal(err)
	}
	st, err := app.W.DbMcp.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: true})
	if err != nil || !st.Running {
		t.Fatalf("SetEnabled = %+v (%v), want running", st, err)
	}
	if got := app.W.DbMcp.Status(); !got.Running || got.Command != st.Command {
		t.Fatalf("Status = %+v, want running with SetEnabled's command", got)
	}
	m := urlRe.FindStringSubmatch(st.Command)
	if m == nil {
		t.Fatalf("Status.Command has no server url: %q", st.Command)
	}
	return &fixture{app: app, url: m[1], connID: conn.ID, dbPath: dbPath}
}

func (f *fixture) token(t *testing.T) string { t.Helper(); return helperToken(t, f.app) }

func (f *fixture) connect(t *testing.T, token string) (*mcp.ClientSession, error) {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "flow-client", Version: "1"}, nil)
	return client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: f.url, HTTPClient: &http.Client{Transport: bearer{token}, Timeout: 30 * time.Second},
	}, nil)
}

func text(res *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

func runQuery(t *testing.T, sess *mcp.ClientSession, connID, sqlText string) *mcp.CallToolResult {
	t.Helper()
	res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "run_query", Arguments: map[string]any{"connectionId": connID, "sql": sqlText}})
	if err != nil {
		t.Fatalf("run_query %q: %v", sqlText, err)
	}
	return res
}

func (f *fixture) noteCount(t *testing.T) int {
	t.Helper()
	db, err := sql.Open("sqlite", f.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow("select count(*) from notes").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (f *fixture) pending(t *testing.T) bridge.DbMcpApprovalRequest {
	t.Helper()
	var req *bridge.DbMcpApprovalRequest
	testx.WaitUntil(t, 10*time.Second, func() bool {
		req = f.app.W.DbMcp.PendingApprovals().Pending
		return req != nil
	})
	return *req
}

func TestDbMcpApprovalFlow(t *testing.T) {
	f := newFixture(t)
	sess, err := f.connect(t, f.token(t))
	if err != nil {
		t.Fatalf("connect with the helper token: %v", err)
	}
	defer sess.Close()

	list, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "list_connections"})
	if err != nil || list.IsError || !strings.Contains(text(list), f.connID) || !strings.Contains(text(list), "scratch notes") {
		t.Fatalf("list_connections = %q (%v), want the exposed connection with its description", text(list), err)
	}
	if read := runQuery(t, sess, f.connID, "select body from notes order by id"); read.IsError || !strings.Contains(text(read), "two") {
		t.Fatalf("read run_query = %q, want rows without approval", text(read))
	}
	if snap := f.app.W.DbMcp.PendingApprovals(); snap.Pending != nil {
		t.Fatalf("a read queued an approval: %+v", snap)
	}

	const write = "insert into notes (body) values ('three')"
	type outcome struct {
		res *mcp.CallToolResult
		err error
	}
	call := func() chan outcome {
		ch := make(chan outcome, 1)
		go func() {
			res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "run_query", Arguments: map[string]any{"connectionId": f.connID, "sql": write}})
			ch <- outcome{res, err}
		}()
		return ch
	}

	denied := call()
	req := f.pending(t)
	// Contract dbmcp: tests/ui/dbmcp-approval.spec.ts renders this request in the approval dialog.
	f.app.Contract(t, "dbmcp", "DbMcpService.PendingApprovals", bridge.DbMcpApprovalSnapshot{Pending: &req}, flowharness.Mask("expiresAtMs"))
	f.app.Contract(t, "dbmcp", "args:DbMcpService.ApproveQuery", bridge.DbMcpApprovalArgs{RequestID: req.RequestID})
	if req.Statement != write || req.ConnectionID != f.connID || req.Class == "" {
		t.Fatalf("pending approval = %+v, want the write statement on the connection", req)
	}
	if _, err := f.app.W.DbMcp.DenyQuery(bridge.DbMcpApprovalArgs{RequestID: req.RequestID}); err != nil {
		t.Fatal(err)
	}
	out := <-denied
	if out.err != nil || out.res == nil || !out.res.IsError {
		t.Fatalf("denied write = %+v, want a tool error", out)
	}
	if n := f.noteCount(t); n != 2 {
		t.Fatalf("denied write changed the table: %d rows", n)
	}

	approved := call()
	req = f.pending(t)
	if _, err := f.app.W.DbMcp.ApproveQuery(bridge.DbMcpApprovalArgs{RequestID: req.RequestID}); err != nil {
		t.Fatal(err)
	}
	out = <-approved
	if out.err != nil || out.res == nil || out.res.IsError {
		t.Fatalf("approved write = %+v (%s), want success", out, text(out.res))
	}
	if n := f.noteCount(t); n != 3 {
		t.Fatalf("approved write left %d rows, want 3", n)
	}
	if snap := f.app.W.DbMcp.PendingApprovals(); snap.Pending != nil || snap.Queued != 0 {
		t.Fatalf("approvals left behind: %+v", snap)
	}

	if ddl := runQuery(t, sess, f.connID, "drop table notes"); !ddl.IsError {
		t.Fatalf("DDL on a deny connection = %q, want a tool error", text(ddl))
	}

	old := f.token(t)
	st := f.app.W.DbMcp.Regenerate()
	if !st.Running {
		t.Fatalf("Regenerate = %+v, want still running", st)
	}
	if fresh := f.token(t); fresh == old {
		t.Fatal("Regenerate kept the token")
	}
	if s, err := f.connect(t, old); err == nil {
		s.Close()
		t.Fatal("old token still connects after Regenerate")
	}
	s2, err := f.connect(t, f.token(t))
	if err != nil {
		t.Fatalf("new token rejected: %v", err)
	}
	s2.Close()

	if st, err := f.app.W.DbMcp.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: false}); err != nil || st.Running {
		t.Fatalf("SetEnabled(false) = %+v (%v), want stopped", st, err)
	}
}

// noClaude is a real mcpinstall.Installer that finds nothing and must not spawn anything.
func noClaude(t *testing.T) *mcpinstall.Installer {
	return mcpinstall.New(mcpinstall.Deps{
		LookPath: func(string) (string, error) { return "", os.ErrNotExist },
		Stat:     func(string) (os.FileInfo, error) { return nil, os.ErrNotExist },
		Run: func(context.Context, string, []string) error {
			t.Error("mcpinstall spawned a process although claude is missing")
			return nil
		},
	})
}

func TestInstallClaudeCodeWithoutCli(t *testing.T) {
	app := flowharness.New(t)
	app.W.DbMcp.Installer = noClaude(t)

	if res := app.W.DbMcp.InstallClaudeCode(ctx); res.Outcome != mcpinstall.OutcomeNotFound {
		t.Fatalf("InstallClaudeCode with the server off = %+v, want notFound", res)
	}
	st, err := app.W.DbMcp.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: true})
	if err != nil || !st.Running {
		t.Fatalf("SetEnabled = %+v (%v)", st, err)
	}
	if st.ClaudeAvailable || len(st.Probed) == 0 || !strings.Contains(st.Command, "claude mcp add-json") {
		t.Fatalf("Status = %+v, want claude unavailable, the probed paths and a copyable command", st)
	}
	res := app.W.DbMcp.InstallClaudeCode(ctx)
	if res.Outcome != mcpinstall.OutcomeNotFound || len(res.Probed) == 0 {
		t.Fatalf("InstallClaudeCode = %+v, want notFound with the probed paths", res)
	}
	if strings.Contains(st.Command, helperToken(t, app)) {
		t.Fatal("the copyable command carries the token")
	}
	if entries, _ := os.ReadDir(filepath.Join(app.Home, ".claude")); len(entries) != 0 {
		t.Fatalf("install wrote into ~/.claude: %v", entries)
	}
	if _, err := os.Stat(filepath.Join(app.Home, ".claude.json")); err == nil {
		t.Fatal("install wrote ~/.claude.json")
	}
}

func helperToken(t *testing.T, app *flowharness.App) string {
	t.Helper()
	plain, ok, err := mcpauth.LoadHelperToken(mcpauth.HelperTokenPathNamed(app.KiraHome, "mcp-db"))
	if err != nil || !ok {
		t.Fatalf("helper token: ok=%v err=%v", ok, err)
	}
	return plain
}
