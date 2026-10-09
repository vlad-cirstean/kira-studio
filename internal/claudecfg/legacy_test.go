package claudecfg

import (
	"os"
	"path/filepath"
	"testing"
)

func detect(t *testing.T, servers string) []string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".claude.json")
	if err := os.WriteFile(path, []byte(`{"projects":{"/x":{"mcpServers":{"kira-memory":{"type":"stdio","command":"/a/kira-space","args":["memory-mcp"]}}}},"mcpServers":`+servers+`}`), 0o600); err != nil {
		t.Fatal(err)
	}
	l, err := DetectLegacy(path)
	if err != nil {
		t.Fatal(err)
	}
	return l.Names()
}

// TestDetectLegacyMatchesOnlyKiraShapes guards the cleanup scope: an entry is listed only when
// every field matches what a Kira version wrote, so a user's own server is never removed.
func TestDetectLegacyMatchesOnlyKiraShapes(t *testing.T) {
	const mem = `{"type":"stdio","command":"/Applications/Kira Space.app/Contents/MacOS/Kira Space","args":["memory-mcp"]`
	cases := []struct {
		name    string
		servers string
		want    []string
	}{
		{"memory exact", `{"kira-memory":` + mem + `}}`, []string{"kira-memory"}},
		{"memory dev binary", `{"kira-memory":{"type":"stdio","command":"/src/bin/kira-space","args":["memory-mcp"]}}`, []string{"kira-memory"}},
		{"memory extra env", `{"kira-memory":` + mem + `,"env":{"A":"b"}}}`, nil},
		{"memory other binary", `{"kira-memory":{"type":"stdio","command":"/usr/bin/node","args":["memory-mcp"]}}`, nil},
		{"memory relative command", `{"kira-memory":{"type":"stdio","command":"kira-space","args":["memory-mcp"]}}`, nil},
		{"memory other args", `{"kira-memory":{"type":"stdio","command":"/a/kira-space","args":["memory-mcp","--x"]}}`, nil},
		{"memory other name", `{"kira-memory-dev":` + mem + `}}`, nil},
		{"db helper quoted", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headersHelper":"'/Users/a b/.kira/mcp-header-helper.sh'"}}`, []string{"kira-db"}},
		{"db helper bare localhost", `{"kira-db":{"type":"http","url":"http://localhost:8766/mcp","headersHelper":"/h/mcp-header-helper.sh"}}`, []string{"kira-db"}},
		{"db helper other script", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headersHelper":"/h/other.sh"}}`, nil},
		{"db pre-F2 bearer", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headers":{"Authorization":"Bearer abc"}}}`, []string{"kira-db"}},
		{"db empty bearer", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headers":{"Authorization":"Bearer "}}}`, nil},
		{"db extra header", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headers":{"Authorization":"Bearer a","X":"y"}}}`, nil},
		{"db helper and headers", `{"kira-db":{"type":"http","url":"http://127.0.0.1:8766/mcp","headersHelper":"/h/mcp-header-helper.sh","headers":{"Authorization":"Bearer a"}}}`, nil},
		{"db other port", `{"kira-db":{"type":"http","url":"http://127.0.0.1:9000/mcp","headersHelper":"/h/mcp-header-helper.sh"}}`, nil},
		{"db remote host", `{"kira-db":{"type":"http","url":"http://db.example.com:8766/mcp","headersHelper":"/h/mcp-header-helper.sh"}}`, nil},
		{"repo-map bearer", `{"kira-repo-map":{"type":"http","url":"http://127.0.0.1:51234/mcp","headers":{"Authorization":"Bearer t"}}}`, []string{"kira-repo-map"}},
		{"repo-map helper form never shipped", `{"kira-repo-map":{"type":"http","url":"http://127.0.0.1:51234/mcp","headersHelper":"/h/mcp-header-helper.sh"}}`, nil},
		{"repo-map bad port", `{"kira-repo-map":{"type":"http","url":"http://127.0.0.1:70000/mcp","headers":{"Authorization":"Bearer t"}}}`, nil},
		{"user server only", `{"mine":{"type":"stdio","command":"/usr/bin/mine"}}`, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := detect(t, c.servers)
			if len(got) != len(c.want) || (len(got) > 0 && got[0] != c.want[0]) {
				t.Fatalf("detected %v, want %v", got, c.want)
			}
		})
	}
}
