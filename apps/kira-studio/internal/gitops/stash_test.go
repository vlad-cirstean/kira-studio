package gitops_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

func strPtr(s string) *string { return &s }

// TestStashPushArgs_LiteralPathspec is D14/F16/probe P22's own golden: every generated path is
// prefixed with `:(literal)` — the two-line hardening that closes a real over-match bug
// (`stash push -- 'x*.txt'` stashed `xy.txt` too) even though no caller in this repo populates
// paths today.
func TestStashPushArgs_LiteralPathspec(t *testing.T) {
	t.Parallel()
	got := gitops.StashPushArgs(nil, false, false, []string{"a*.txt", "b.txt"})
	want := []string{"stash", "push", "--", ":(literal)a*.txt", ":(literal)b.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StashPushArgs(paths) = %v, want %v", got, want)
	}
}

func TestStashPushArgs_NoPathsNoTrailingDashDash(t *testing.T) {
	t.Parallel()
	got := gitops.StashPushArgs(nil, true, false, nil)
	want := []string{"stash", "push", "-u"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StashPushArgs(no paths) = %v, want %v", got, want)
	}
}

func TestStashPushArgs_MessageAndKeepIndex(t *testing.T) {
	t.Parallel()
	got := gitops.StashPushArgs(strPtr("my message"), false, true, nil)
	want := []string{"stash", "push", "-k", "-m", "my message"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StashPushArgs = %v, want %v", got, want)
	}
}

// TestAutoStashMessage_NoNewline is D3's own guard: the message becomes a single reflog-subject
// line, so it must never contain one, and must carry the deliberate marker prefix (D1).
func TestAutoStashMessage_NoNewline(t *testing.T) {
	t.Parallel()
	got := gitops.AutoStashMessage("feature/topic")
	want := "auto-stash: switching to feature/topic"
	if got != want {
		t.Fatalf("AutoStashMessage = %q, want %q", got, want)
	}
	if strings.ContainsAny(got, "\n\r") {
		t.Fatalf("AutoStashMessage contains a newline: %q", got)
	}
	if !strings.HasPrefix(got, gitops.AutoStashMessagePrefix) {
		t.Fatalf("AutoStashMessage %q does not start with the marker prefix %q", got, gitops.AutoStashMessagePrefix)
	}
}

func TestStashCreateArgs(t *testing.T) {
	t.Parallel()
	got := gitops.StashCreateArgs("my label")
	want := []string{"stash", "create", "my label"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StashCreateArgs = %v, want %v", got, want)
	}
}

func TestStashBranchByShaArgs(t *testing.T) {
	t.Parallel()
	got := gitops.StashBranchByShaArgs("newbranch", "abc123")
	want := []string{"stash", "branch", "newbranch", "abc123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StashBranchByShaArgs = %v, want %v", got, want)
	}
}

func TestGlobalStashRef(t *testing.T) {
	t.Parallel()
	got := gitops.GlobalStashRef("deadbeef")
	want := "refs/kira/globalstash/deadbeef"
	if got != want {
		t.Fatalf("GlobalStashRef = %q, want %q", got, want)
	}
	if !strings.HasPrefix(got, gitops.GlobalStashRefPrefix) {
		t.Fatalf("GlobalStashRef %q does not start with GlobalStashRefPrefix %q", got, gitops.GlobalStashRefPrefix)
	}
}

func TestGlobalStashSetArgs(t *testing.T) {
	t.Parallel()
	got := gitops.GlobalStashSetArgs("deadbeef")
	want := []string{"update-ref", "refs/kira/globalstash/deadbeef", "deadbeef"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GlobalStashSetArgs = %v, want %v", got, want)
	}
}

// TestGlobalStashDeleteArgs_ExpectedOldValue is D11's own golden: the delete argv passes the
// expected old value (the sha itself), so a concurrent change to the same ref refuses rather than
// silently deleting whatever now sits there.
func TestGlobalStashDeleteArgs_ExpectedOldValue(t *testing.T) {
	t.Parallel()
	got := gitops.GlobalStashDeleteArgs("deadbeef")
	want := []string{"update-ref", "-d", "refs/kira/globalstash/deadbeef", "deadbeef"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GlobalStashDeleteArgs = %v, want %v", got, want)
	}
}

func TestGlobalStashRefExistsArgs(t *testing.T) {
	t.Parallel()
	got := gitops.GlobalStashRefExistsArgs("deadbeef")
	want := []string{"for-each-ref", "--format=%(objectname)", "refs/kira/globalstash/deadbeef"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GlobalStashRefExistsArgs = %v, want %v", got, want)
	}
}

func TestGlobalStashListRefsArgs(t *testing.T) {
	t.Parallel()
	got := gitops.GlobalStashListRefsArgs()
	want := []string{"for-each-ref", "--format=%(objectname)", "refs/kira/globalstash/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GlobalStashListRefsArgs = %v, want %v", got, want)
	}
}

func TestCommitTreeArgs(t *testing.T) {
	t.Parallel()
	got := gitops.CommitTreeArgs("treeSha", []string{"base", "index", "untracked"}, "On main: my label")
	want := []string{"commit-tree", "treeSha", "-p", "base", "-p", "index", "-p", "untracked", "-m", "On main: my label"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("CommitTreeArgs = %v, want %v", got, want)
	}
}

func TestCommitTreeArgs_SingleParent(t *testing.T) {
	t.Parallel()
	got := gitops.CommitTreeArgs("treeSha", []string{"base"}, "On main: label")
	want := []string{"commit-tree", "treeSha", "-p", "base", "-m", "On main: label"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("CommitTreeArgs = %v, want %v", got, want)
	}
}
