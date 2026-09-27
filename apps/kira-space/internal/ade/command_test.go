package ade

import (
	"os/exec"
	"testing"
)

// TestQuotePOSIX_RoundTrip proves quotePOSIX's own quoting survives a real POSIX shell parse
// (sh -c 'printf %s <quoted>'), rather than merely asserting the escaped string looks right —
// exactly the "prove round trip" bar CLAUDE.md sets for a hand-rolled quoting edge case set.
func TestQuotePOSIX_RoundTrip(t *testing.T) {
	cases := []string{
		"",
		"plain",
		"has space",
		"it's a test",
		"''double single''",
		"back\\slash",
		"dollar $HOME sign",
		"line1\nline2",
		"trailing'",
		"'leading",
	}
	for _, s := range cases {
		quoted := quotePOSIX(s)
		out, err := exec.Command("sh", "-c", "printf %s "+quoted).Output()
		if err != nil {
			t.Fatalf("quotePOSIX(%q) = %q: sh -c failed: %v", s, quoted, err)
		}
		if string(out) != s {
			t.Fatalf("quotePOSIX(%q) = %q: round trip = %q, want %q", s, quoted, string(out), s)
		}
	}
}

func TestNewCommandAndResumeCommand(t *testing.T) {
	if got, want := newCommand("claude", "abc-123"), "claude --session-id abc-123"; got != want {
		t.Fatalf("newCommand = %q, want %q", got, want)
	}
	if got, want := resumeCommand("claude", "abc-123"), "claude --resume abc-123"; got != want {
		t.Fatalf("resumeCommand = %q, want %q", got, want)
	}
}
