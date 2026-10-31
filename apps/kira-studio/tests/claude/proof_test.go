package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/internal/loginshell"
)

// TestProofMcpThroughClaude has the real claude write a validation proof through the kira-db proof
// tools and checks the stored session.
func TestProofMcpThroughClaude(t *testing.T) {
	app := newRealApp(t)
	_, url, helper := enableDbMcp(t, app)
	cfg := filepath.Join(t.TempDir(), "mcp.json")
	raw, err := json.Marshal(map[string]any{"mcpServers": map[string]any{
		dbServer: map[string]any{"type": "http", "url": url, "headersHelper": loginshell.Quote(helper)},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cfg, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	pre := "mcp__" + dbServer + "__"
	app.claudeP(t, t.TempDir(),
		`Use the kira-db proof tools. Call proof_start_session with name "Claude proof". Then call proof_add_step twice with the returned draftId: `+
			`first a table step (description "Two rows", view "table", data {"columns":[{"name":"id"},{"name":"label"}],"rows":[[1,"a"],[2,"b"]]}), `+
			`then a document step (description "One doc", view "document", data {"documents":[{"body":{"ok":true}}]}). `+
			`Then call proof_close_session with the draftId. Reply with the word done.`,
		"--strict-mcp-config", "--mcp-config", cfg,
		"--allowedTools", pre+"proof_start_session,"+pre+"proof_add_step,"+pre+"proof_close_session",
		"--output-format", "stream-json", "--verbose")

	list, err := app.W.Proof.Sessions()
	if err != nil || len(list) != 1 || list[0].Name != "Claude proof" {
		t.Fatalf("Sessions = %+v, %v; want one named %q", list, err, "Claude proof")
	}
	det, err := app.W.Proof.Session(bridge.ProofSessionArgs{SessionID: list[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	steps := det.Current.Steps
	if len(steps) != 2 || steps[0].View != "table" || steps[0].Description != "Two rows" || steps[1].View != "document" || steps[1].Description != "One doc" {
		t.Fatalf("steps = %+v, want table then document in order", steps)
	}
}
