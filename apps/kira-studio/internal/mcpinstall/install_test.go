package mcpinstall

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestShellSingleQuoteRoundTrips guards the one property Command/Install's own headersHelper value
// depends on (F10): wrapping in single quotes must survive a POSIX shell splitting the resulting
// string on whitespace, including a path that itself contains a single quote.
func TestShellSingleQuoteRoundTrips(t *testing.T) {
	cases := []string{
		"/plain/path/mcp-header-helper.sh",
		"/Users/vlad cirstean/.kira/mcp-header-helper.sh",
		"/tmp/weird's path/mcp-header-helper.sh",
	}
	for _, in := range cases {
		quoted := shellSingleQuote(in)
		if !strings.HasPrefix(quoted, "'") || !strings.HasSuffix(quoted, "'") {
			t.Fatalf("shellSingleQuote(%q) = %q, want a leading and trailing single quote", in, quoted)
		}
	}
}

// TestCommandQuotesHeadersHelperPath guards F10: the displayed command's own JSON payload must
// carry a single-quoted headersHelper value, the same way Install below sends it, so a path with a
// space in it does not silently split into two shell words once Claude Code later runs it.
func TestCommandQuotesHeadersHelperPath(t *testing.T) {
	helperPath := "/Users/vlad cirstean/.kira/mcp-header-helper.sh"
	cmd := Command("kira-db", "http://127.0.0.1:8766/mcp", helperPath)

	// Extract the add-json payload — the single-quoted JSON blob after "add-json --scope user
	// kira-db ".
	idx := strings.Index(cmd, "add-json --scope user kira-db '")
	if idx < 0 {
		t.Fatalf("command %q does not contain the expected add-json invocation", cmd)
	}
	payloadStart := idx + len("add-json --scope user kira-db '")
	payloadJSON := cmd[payloadStart : len(cmd)-1] // trailing closing quote

	var decoded serverJSON
	if err := json.Unmarshal([]byte(payloadJSON), &decoded); err != nil {
		t.Fatalf("payload is not valid JSON: %v (payload: %s)", err, payloadJSON)
	}
	want := shellSingleQuote(helperPath)
	if decoded.HeadersHelper != want {
		t.Fatalf("HeadersHelper = %q, want %q (single-quoted)", decoded.HeadersHelper, want)
	}
}

// TestInstallRefusesRelativeHeaderHelperPath guards F10's other half: a relative helperPath
// resolves against Claude Code's own cwd, not Kira's (reachable when os.UserHomeDir fails and
// kirapaths.Home falls back to a relative path) — Install must refuse outright rather than
// register a headersHelper that silently reads the wrong file.
func TestInstallRefusesRelativeHeaderHelperPath(t *testing.T) {
	ran := false
	installer := New(Deps{
		LookPath: func(string) (string, error) { return "/usr/local/bin/claude", nil },
		Stat:     func(string) (os.FileInfo, error) { return nil, os.ErrNotExist },
		Run: func(context.Context, string, []string) error {
			ran = true
			return nil
		},
	})

	res := installer.Install(context.Background(), "kira-db", "http://127.0.0.1:8766/mcp", "relative/path.sh")
	if res.Outcome != OutcomeInstallFailed {
		t.Fatalf("Outcome = %q, want %q", res.Outcome, OutcomeInstallFailed)
	}
	if ran {
		t.Fatal("Install spawned claude despite a relative helper path — must refuse before any spawn")
	}
}

// TestInstallQuotesHeaderHelperPathInPayload confirms Install sends the same quoted form Command
// displays, over a captured add-json payload.
func TestInstallQuotesHeaderHelperPathInPayload(t *testing.T) {
	helperPath := "/Users/vlad cirstean/.kira/mcp-header-helper.sh"
	var addPayload string
	installer := New(Deps{
		LookPath: func(string) (string, error) { return "/usr/local/bin/claude", nil },
		Run: func(_ context.Context, _ string, args []string) error {
			if len(args) > 0 && args[0] == "mcp" && len(args) > 1 && args[1] == "add-json" {
				addPayload = args[len(args)-1]
			}
			return nil
		},
	})

	res := installer.Install(context.Background(), "kira-db", "http://127.0.0.1:8766/mcp", helperPath)
	if res.Outcome != OutcomeInstalled {
		t.Fatalf("Outcome = %q, want %q (detail: %s)", res.Outcome, OutcomeInstalled, res.Detail)
	}
	var decoded serverJSON
	if err := json.Unmarshal([]byte(addPayload), &decoded); err != nil {
		t.Fatalf("captured add-json payload is not valid JSON: %v (%s)", err, addPayload)
	}
	want := shellSingleQuote(helperPath)
	if decoded.HeadersHelper != want {
		t.Fatalf("HeadersHelper = %q, want %q (single-quoted)", decoded.HeadersHelper, want)
	}
}
