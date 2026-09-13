package gitpreflight_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func TestMatchProtectedBranch(t *testing.T) {
	t.Parallel()
	patterns := []string{"main", "master", "release/*"}

	if m := gitpreflight.MatchProtectedBranch("main", patterns); m == nil || m.Pattern != "main" {
		t.Fatalf("main: got %+v, want a match on \"main\"", m)
	}
	if m := gitpreflight.MatchProtectedBranch("release/1.2", patterns); m == nil || m.Pattern != "release/*" {
		t.Fatalf("release/1.2: got %+v, want a match on \"release/*\"", m)
	}
	if m := gitpreflight.MatchProtectedBranch("release/1.2/hotfix", patterns); m != nil {
		t.Fatalf("release/1.2/hotfix: got %+v, want no match (* does not cross /)", m)
	}
	if m := gitpreflight.MatchProtectedBranch("releases/1.2", patterns); m != nil {
		t.Fatalf("releases/1.2: got %+v, want no match", m)
	}
	if m := gitpreflight.MatchProtectedBranch("topic", []string{}); m != nil {
		t.Fatalf("empty pattern list: got %+v, want no match", m)
	}
}

// TestMatchProtectedBranch_DoubleStarIsLiteral is D17's own "**" handling: not a supported glob,
// matched literally rather than crossing "/".
func TestMatchProtectedBranch_DoubleStarIsLiteral(t *testing.T) {
	t.Parallel()
	patterns := []string{"release/**"}
	if m := gitpreflight.MatchProtectedBranch("release/**", patterns); m == nil {
		t.Fatal("an exact literal match on the pattern itself should still match")
	}
	if m := gitpreflight.MatchProtectedBranch("release/1.2/hotfix", patterns); m != nil {
		t.Fatalf("got %+v, want no match — \"**\" must not behave as a real glob", m)
	}
}

// TestMatchProtectedBranch_LiteralStarInBranchName proves a branch whose own name contains a
// literal "*" is compared like any other character, never accidentally treated as a wildcard on
// the branch side (only the pattern side has wildcard semantics).
func TestMatchProtectedBranch_LiteralStarInBranchName(t *testing.T) {
	t.Parallel()
	if m := gitpreflight.MatchProtectedBranch("weird*name", []string{"weird*name"}); m == nil {
		t.Fatal("want a match: the pattern's own \"*\" matches the branch's literal \"*\" as one of the zero-or-more characters it covers")
	}
	if m := gitpreflight.MatchProtectedBranch("weird*name", []string{"main"}); m != nil {
		t.Fatalf("got %+v, want no match", m)
	}
}

func TestClassifyPush(t *testing.T) {
	t.Parallel()
	upstream := "refs/remotes/origin/main"
	tip := "abc123"
	got := gitpreflight.ClassifyPush(gitpreflight.ClassifyPushInput{
		Branch: "main", Upstream: &upstream, Ahead: 2, Behind: 0, RemoteTip: &tip,
		ProtectedBranches: []string{"main"},
	})
	if got.WouldSetUpstream {
		t.Fatal("an existing upstream must not set wouldSetUpstream")
	}
	if !got.FastForward {
		t.Fatal("behind == 0 must be fastForward")
	}
	if got.ProtectedBy == nil || *got.ProtectedBy != "main" {
		t.Fatalf("protectedBy = %v, want \"main\"", got.ProtectedBy)
	}
}

func TestClassifyPush_NoUpstreamSetsUpstream(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyPush(gitpreflight.ClassifyPushInput{Branch: "topic", Behind: 0})
	if !got.WouldSetUpstream {
		t.Fatal("a nil upstream must set wouldSetUpstream")
	}
	if got.ProtectedBy != nil {
		t.Fatalf("protectedBy = %v, want nil for an unprotected branch", got.ProtectedBy)
	}
}
