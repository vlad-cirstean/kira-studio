package proofflow

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/proof"
	"github.com/kirathecat/kira-studio/internal/prompts"
)

var ctx = context.Background()

var urlRe = regexp.MustCompile(`"url":"([^"]+)"`)

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

// fixture is an app with the MCP server on and a connected client.
type fixture struct {
	app  *flowharness.App
	sess *mcp.ClientSession
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	app := flowharness.New(t)
	st, err := app.W.DbMcp.SetEnabled(bridge.DbMcpSetEnabledArgs{Enabled: true})
	if err != nil || !st.Running {
		t.Fatalf("SetEnabled = %+v (%v), want running", st, err)
	}
	m := urlRe.FindStringSubmatch(st.Command)
	if m == nil {
		t.Fatalf("Status.Command has no server url: %q", st.Command)
	}
	plain, ok, err := mcpauth.LoadHelperToken(mcpauth.HelperTokenPathNamed(app.KiraHome, "mcp-db"))
	if err != nil || !ok {
		t.Fatalf("helper token: ok=%v err=%v", ok, err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "flow-client", Version: "1"}, nil)
	sess, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint: m[1], HTTPClient: &http.Client{Transport: bearer{plain}, Timeout: 30 * time.Second},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	return &fixture{app: app, sess: sess}
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

// call runs a tool and decodes its JSON answer into out (nil to ignore it).
func (f *fixture) call(t *testing.T, name string, args map[string]any, out any) {
	t.Helper()
	res, err := f.sess.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	if res.IsError {
		t.Fatalf("%s failed: %s", name, text(res))
	}
	if out != nil {
		if err := json.Unmarshal([]byte(text(res)), out); err != nil {
			t.Fatalf("%s answer %q: %v", name, text(res), err)
		}
	}
}

// fail runs a tool that must be refused and returns the message the agent sees.
func (f *fixture) fail(t *testing.T, name string, args map[string]any) string {
	t.Helper()
	res, err := f.sess.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		return err.Error()
	}
	if !res.IsError {
		t.Fatalf("%s succeeded: %s", name, text(res))
	}
	return text(res)
}

func (f *fixture) start(t *testing.T, name string) string {
	t.Helper()
	var r proof.StartResult
	f.call(t, "proof_start_session", map[string]any{"name": name}, &r)
	return r.DraftID
}

func (f *fixture) addStep(t *testing.T, draft string, args map[string]any) int {
	t.Helper()
	args["draftId"] = draft
	var r struct{ Ordinal int }
	f.call(t, "proof_add_step", args, &r)
	return r.Ordinal
}

func (f *fixture) closeDraft(t *testing.T, draft string) proof.CloseResult {
	t.Helper()
	var r proof.CloseResult
	f.call(t, "proof_close_session", map[string]any{"draftId": draft}, &r)
	return r
}

func tableStep(desc string) map[string]any {
	return map[string]any{
		"description": desc, "view": "table", "query": "select id, name, tags from orders", "language": "sql", "source": "postgres",
		"data": map[string]any{
			"columns": []any{map[string]any{"name": "id"}, map[string]any{"name": "name"}, map[string]any{"name": "tags", "type": "json"}},
			"rows":    []any{[]any{1, "alpha", []any{"a", "b"}}, []any{2, nil, nil}, []any{9007199254740993, "<b>bold</b>", map[string]any{"k": 1}}},
		},
	}
}

func documentStep(desc string) map[string]any {
	return map[string]any{
		"description": desc, "view": "document", "source": "elasticsearch", "language": "json",
		"query": `{"query":{"match_all":{}}}`,
		"data": map[string]any{"documents": []any{
			map[string]any{"body": map[string]any{"z": 1, "a": map[string]any{"nested": true}}},
			map[string]any{"id": "doc-b", "body": map[string]any{"title": "Second"}},
		}},
	}
}

func keyValueStep(desc string) map[string]any {
	return map[string]any{
		"description": desc, "view": "keyvalue",
		"data": map[string]any{"entries": []any{
			map[string]any{"field": "status", "value": "ok"},
			map[string]any{"field": "latencyMs", "value": 12.5},
		}},
	}
}

func proofPrompts(t *testing.T, app *flowharness.App) []prompts.Routed {
	t.Helper()
	all, err := app.W.PromptsSvc.List()
	if err != nil {
		t.Fatal(err)
	}
	var out []prompts.Routed
	for _, p := range all {
		if p.Kind == prompts.KindProof {
			out = append(out, p)
		}
	}
	return out
}

func session(t *testing.T, app *flowharness.App, id string) proof.Detail {
	t.Helper()
	d, err := app.W.Proof.Session(bridge.ProofSessionArgs{SessionID: id})
	if err != nil {
		t.Fatalf("Session(%s): %v", id, err)
	}
	return d
}

func sessionID(t *testing.T, app *flowharness.App, name string) string {
	t.Helper()
	list, err := app.W.Proof.Sessions()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range list {
		if s.Name == name {
			return s.ID
		}
	}
	t.Fatalf("no session named %q in %+v", name, list)
	return ""
}
