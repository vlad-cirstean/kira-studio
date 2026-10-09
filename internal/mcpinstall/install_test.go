package mcpinstall

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

// TestShellSingleQuoteRoundTrips guards the one property Command's headersHelper value
// depends on (F10): wrapping in single quotes must survive a POSIX shell splitting the resulting
// string on whitespace, including a path that itself contains a single quote.
func TestShellSingleQuoteRoundTrips(t *testing.T) {
	cases := []string{
		"/plain/path/mcp-header-helper.sh",
		"/Users/vlad cirstean/.kira/mcp-header-helper.sh",
		"/tmp/weird's path/mcp-header-helper.sh",
	}
	for _, in := range cases {
		quoted := ShellQuote(in)
		if !strings.HasPrefix(quoted, "'") || !strings.HasSuffix(quoted, "'") {
			t.Fatalf("ShellQuote(%q) = %q, want a leading and trailing single quote", in, quoted)
		}
	}
}

// TestCommandRoundTripsThroughShell guards F10/P168 Part 6 F1: the copy-paste text, run through a
// real shell, must hand `claude` the intended argv, including for a helper path with a
// space or a single quote.
func TestCommandRoundTripsThroughShell(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("no sh")
	}
	for _, helperPath := range []string{
		"/Users/a/.kira/mcp-header-helper.sh",
		"/Users/a b/.kira/mcp-header-helper.sh",
		"/Users/o'n/.kira/mcp-header-helper.sh",
	} {
		cmd := Command("kira-db", "http://127.0.0.1:8766/mcp", helperPath)
		script := "claude() { for a; do printf '%s\\n' \"$a\"; done; }\n" + cmd
		out, err := exec.Command("sh", "-c", script).Output()
		if err != nil {
			t.Fatalf("sh rejected %q: %v", cmd, err)
		}
		payload, _ := json.Marshal(serverJSON{Type: "http", URL: "http://127.0.0.1:8766/mcp", HeadersHelper: ShellQuote(helperPath)})
		want := "mcp\nremove\n--scope\nuser\nkira-db\nmcp\nadd-json\n--scope\nuser\nkira-db\n" + string(payload) + "\n"
		if string(out) != want {
			t.Errorf("helper %q: shell argv = %q, want %q", helperPath, out, want)
		}
	}
}
