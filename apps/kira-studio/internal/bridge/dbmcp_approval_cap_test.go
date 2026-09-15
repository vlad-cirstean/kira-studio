package bridge

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// TestCapApprovalStatementShowsHeadAndTail is finding #5 (M6): a statement over the cap must show
// both ends, with a clear omitted-bytes marker between them, so a padded/hidden tail (e.g. a real
// row-touching clause tacked on after filler) can never sit entirely past the visible window while
// the dialog tells the human "the full text still runs".
func TestCapApprovalStatementShowsHeadAndTail(t *testing.T) {
	t.Run("short statement is unchanged", func(t *testing.T) {
		text, truncated := capApprovalStatement("SELECT 1")
		if truncated {
			t.Fatal("truncated = true, want false for a short statement")
		}
		if text != "SELECT 1" {
			t.Fatalf("text = %q, want unchanged", text)
		}
	})

	t.Run("long statement shows both head and tail", func(t *testing.T) {
		head := "UPDATE customers SET tier='basic' WHERE id=1 "
		filler := strings.Repeat("x", dbMcpApprovalStatementCap*2)
		tail := " OR 1=1 -- real effect hidden past a naive head-only cap"
		statement := head + filler + tail

		text, truncated := capApprovalStatement(statement)
		if !truncated {
			t.Fatal("truncated = false, want true for an oversized statement")
		}
		if !strings.HasPrefix(text, head) {
			t.Fatalf("text does not start with the real head: %q...", text[:60])
		}
		if !strings.HasSuffix(text, tail) {
			t.Fatalf("text does not end with the real tail: ...%q", text[len(text)-60:])
		}
		if !strings.Contains(text, "bytes omitted") {
			t.Fatalf("text has no omitted-bytes marker: %q", text)
		}
		// The dangerous case this finding closes: the tail must be visible somewhere in the
		// displayed text, not silently dropped.
		if !strings.Contains(text, "OR 1=1") {
			t.Fatal("hidden tail clause is not visible anywhere in the displayed text")
		}
	})

	t.Run("cuts land at rune boundaries", func(t *testing.T) {
		// A multi-byte rune (é, 2 bytes in UTF-8) straddling either cut point must not split.
		head := strings.Repeat("é", dbMcpApprovalStatementHalf) // lands mid-rune at the byte cap
		tail := strings.Repeat("é", dbMcpApprovalStatementHalf)
		statement := head + strings.Repeat("x", 100) + tail

		text, truncated := capApprovalStatement(statement)
		if !truncated {
			t.Fatal("truncated = false, want true")
		}
		if !utf8.ValidString(text) {
			t.Fatalf("capApprovalStatement produced invalid UTF-8: %q", text)
		}
	})
}
