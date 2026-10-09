package claudeheadless

import "testing"

func TestScriptSessionShapes(t *testing.T) {
	base := Spec{ClaudeBin: "claude", SessionID: "s-1", MCPConfigPath: "/c/run.mcp.json", SettingSources: "user", AllowedTools: []string{"Write", "Bash(touch *)"}}
	fresh := "exec claude -p --output-format stream-json --verbose --session-id 's-1' --mcp-config '/c/run.mcp.json' --setting-sources 'user' --allowedTools 'Write' 'Bash(touch *)'"
	if got := Script(base); got != fresh {
		t.Fatalf("fresh:\n got %s\nwant %s", got, fresh)
	}
	base.Resume = "r-9"
	resumed := "exec claude -p --output-format stream-json --verbose --resume 'r-9' --mcp-config '/c/run.mcp.json' --setting-sources 'user' --allowedTools 'Write' 'Bash(touch *)'"
	if got := Script(base); got != resumed {
		t.Fatalf("resume:\n got %s\nwant %s", got, resumed)
	}
}
