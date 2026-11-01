package claude

import (
	"os"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/internal/harness"
)

func TestParseMCPList(t *testing.T) {
	raw, err := os.ReadFile("testdata/mcp-list-2.1.316.txt")
	if err != nil {
		t.Fatal(err)
	}
	want := []harness.UserServer{
		{Name: "local", Transport: "stdio", Target: "python3", Status: "connected"},
		{Name: "remote", Transport: "http", Target: "127.0.0.1:9", Status: "failed"},
		{Name: "stream", Transport: "sse", Target: "127.0.0.1:9", Status: "failed"},
		{Name: "authy", Transport: "http", Target: "mcp.example.com:8443", Status: "failed"},
		{Name: "my_srv-2", Transport: "stdio", Target: "true", Status: "failed"},
		{Name: "tick", Transport: "stdio", Target: "npx", Status: "connected"},
		{Name: "cross", Transport: "stdio", Target: "node", Status: "failed"},
	}
	got := parseMCPList(string(raw))
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if out := parseMCPList("No MCP servers configured. Use `claude mcp add` to add a server.\n"); len(out) != 0 {
		t.Errorf("empty config = %+v", out)
	}
	for in, want := range map[string]string{"a: x - ! Needs authentication": "needsAuth", "a: x - … Pending…": "pending", "a: x - ? what": "unknown"} {
		if got := parseMCPList(in); len(got) != 1 || got[0].Status != want {
			t.Errorf("%q = %+v, want %s", in, got, want)
		}
	}
	if j := strings.Join([]string{got[0].Target, got[1].Target}, ""); strings.Contains(j, "srv") {
		t.Errorf("target kept path: %s", j)
	}
}
