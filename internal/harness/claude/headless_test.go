package claude

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/harness"
)

func TestScriptSessionShapes(t *testing.T) {
	base := harness.HeadlessSpec{Bin: "claude", SessionID: "s-1", MCPConfigs: []string{"/c/run.mcp.json"}, Config: harness.ConfigUser, AllowedTools: []string{"Write", "Bash(touch *)"}}
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

func TestScriptSandboxWrap(t *testing.T) {
	s := harness.HeadlessSpec{Bin: "claude", SessionID: "s-1", MCPConfigs: []string{"/c/run.mcp.json"}, Config: harness.ConfigUser,
		Sandbox: &harness.SandboxExec{Profile: "/p/it's.sb", Unset: []string{"SSH_AUTH_SOCK"}, Env: []string{"TMPDIR=/s/tmp", "GOFLAGS=-modcacherw"}}}
	want := `exec /usr/bin/env -u 'SSH_AUTH_SOCK' 'TMPDIR=/s/tmp' 'GOFLAGS=-modcacherw' '/usr/bin/sandbox-exec' -f '/p/it'\''s.sb' claude -p --output-format stream-json --verbose --session-id 's-1' --mcp-config '/c/run.mcp.json' --setting-sources 'user'`
	if got := Script(s); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}
