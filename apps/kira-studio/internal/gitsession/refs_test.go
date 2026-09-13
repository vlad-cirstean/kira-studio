package gitsession

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// TestSubtractOwnWorktree_NFDWorktreePathMatchesNFCOwnRoot is G27 F4's regression guard.
// subtractOwnWorktree itself is unchanged by this phase — the fix is D5a (Identify composes
// Root) plus D5c (ParseRefRows composes %(worktreepath)) making both sides of this comparison
// NFC by the time they reach here, not a new normalization call inside this function. So this
// test exercises the real pipeline — ParseRefRows over a decomposed %(worktreepath), exactly as
// git's own readdir-sourced worktree registry could hand it back, then subtractOwnWorktree
// against a composed ownRoot (exactly as Identify hands it back, D5a) — and asserts the outcome,
// which is what keeps this test holding if the mechanism ever moves (plan §0.4).
//
// Byte literals only (D12): no filesystem involved, so the case holds regardless of what this
// container's own filesystem does with the two forms (P1).
func TestSubtractOwnWorktree_NFDWorktreePathMatchesNFCOwnRoot(t *testing.T) {
	t.Parallel()
	composedE := string([]byte{0xc3, 0xa9})         // U+00E9, composed "é"
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"

	// A hand-built LF-framed for-each-ref record (RefsFormat's own eleven \x1f-delimited fields)
	// whose %(worktreepath) is spelled NFD — exactly as git's own worktree registry could report
	// it before D3's core.precomposeunicode=true, or on a pre-G27 client's persisted state.
	record := "refs/heads/main\x1f" + strings.Repeat("a", 40) + "\x1fcommit\x1f\x1f\x1f0\x1f*\x1f\x1f" +
		"/repo/caf" + decomposedE + "\x1f\x1f\n"
	rows, err := porcelain.ParseRefRows([]byte(record), false)
	if err != nil {
		t.Fatalf("ParseRefRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}

	// ownRoot as Identify (D5a) would hand it back: composed.
	ownRoot := "/repo/caf" + composedE

	out := subtractOwnWorktree(rows, ownRoot)
	if len(out) != 1 {
		t.Fatalf("got %d rows, want 1", len(out))
	}
	if out[0].CheckedOutIn != nil {
		t.Errorf("CheckedOutIn = %q, want nil (own worktree, two spellings of one directory)", *out[0].CheckedOutIn)
	}
}

// TestSubtractOwnWorktree_DifferentWorktreeIsKept is the negative twin: a genuinely different
// worktree's CheckedOutIn must survive even once both sides are NFC.
func TestSubtractOwnWorktree_DifferentWorktreeIsKept(t *testing.T) {
	t.Parallel()
	composedE := string([]byte{0xc3, 0xa9})
	ownRoot := "/repo/caf" + composedE
	elsewhere := "/repo-wt/caf" + composedE

	rows := []porcelain.RefRow{{Refname: "refs/heads/feature", CheckedOutIn: &elsewhere}}
	out := subtractOwnWorktree(rows, ownRoot)

	if len(out) != 1 || out[0].CheckedOutIn == nil || *out[0].CheckedOutIn != elsewhere {
		t.Fatalf("out = %+v, want CheckedOutIn preserved as %q", out, elsewhere)
	}
}
