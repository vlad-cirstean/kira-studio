package claude

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// A caller whose context ends must not fail the shared flight the others wait on.
func TestUserServersFlightSurvivesCallerCancel(t *testing.T) {
	bin := t.TempDir()
	script := "#!/bin/sh\nsleep 1\necho 'alpha: /usr/bin/alpha - ✓ Connected'\n"
	// The shell stands in for the login shell, so a profile cannot put a real claude first on PATH.
	for _, name := range []string{"claude", "shell"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("SHELL", filepath.Join(bin, "shell"))
	p := &Provider{}
	dir := t.TempDir()
	first, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, _, err := p.userServers(first, dir, 0)
		done <- err
	}()
	res := make(chan []harness.UserServer, 1)
	go func() {
		s, _, _ := p.userServers(context.Background(), dir, 0)
		res <- s
	}()
	time.Sleep(200 * time.Millisecond)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled caller = %v, want context.Canceled", err)
	}
	s := <-res
	if len(s) != 1 || s[0].Name != "alpha" {
		t.Errorf("other caller = %+v, want alpha", s)
	}
}
