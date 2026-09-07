package gitops_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

func TestClassifyOpError_AlreadyExists(t *testing.T) {
	for _, stderr := range []string{
		"fatal: A branch named 'feature2' already exists.",
		"fatal: tag 'v1.0' already exists",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "AlreadyExists" {
			t.Fatalf("%q -> %q, want AlreadyExists", stderr, kind)
		}
	}
}

func TestClassifyOpError_NotFullyMerged(t *testing.T) {
	stderr := "error: The branch 'feature2' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D feature2'."
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "NotFullyMerged" {
		t.Fatalf("got %q", kind)
	}
}

func TestClassifyOpError_WorktreeConflict(t *testing.T) {
	for _, tc := range []struct {
		stderr   string
		exitCode int
	}{
		{"fatal: 'feature2' is already used by worktree at '/tmp/g5b-wt'", 128},
		{"error: cannot delete branch 'feature2' used by worktree at '/tmp/g5b-wt'", 1},
	} {
		if kind, _ := gitops.ClassifyOpError(tc.stderr, tc.exitCode); kind != "WorktreeConflict" {
			t.Fatalf("%q -> %q, want WorktreeConflict", tc.stderr, kind)
		}
	}
}

func TestClassifyOpError_MainlineRequired(t *testing.T) {
	stderr := "error: commit 7c7eba7f1a2b3c4d5e6f7890abcdef1234567890 is a merge but no -m option was given.\nfatal: revert failed"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "MainlineRequired" {
		t.Fatalf("got %q", kind)
	}
}

func TestClassifyOpError_UntrackedWouldBeOverwritten(t *testing.T) {
	for _, stderr := range []string{
		"error: The following untracked working tree files would be overwritten by checkout:\n\tonlyonside.txt",
		"error: Untracked working tree file 'onlyonside.txt' would be overwritten by merge.",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "UntrackedWouldBeOverwritten" {
			t.Fatalf("%q -> %q, want UntrackedWouldBeOverwritten", stderr, kind)
		}
	}
}

func TestClassifyOpError_DirtyWorktree(t *testing.T) {
	stderr := "error: Your local changes to the following files would be overwritten by checkout:\n\tf.txt"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "DirtyWorktree" {
		t.Fatalf("got %q", kind)
	}
}

func TestClassifyOpError_OperationInProgress(t *testing.T) {
	for _, stderr := range []string{
		"fatal: cannot switch branch while reverting",
		"fatal: There is no merge in progress (MERGE_HEAD missing).",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "OperationInProgress" {
			t.Fatalf("%q -> %q, want OperationInProgress", stderr, kind)
		}
	}
}

func TestClassifyOpError_Conflict(t *testing.T) {
	stderr := "error: could not revert 7c7eba7... c1"
	kind, msg := gitops.ClassifyOpError(stderr, 1)
	if kind != "Conflict" {
		t.Fatalf("got %q, want Conflict — not Unknown (the ordering assertion)", kind)
	}
	if msg != stderr {
		t.Fatalf("message = %q, want the trimmed stderr verbatim", msg)
	}
}

func TestClassifyOpError_NotFound(t *testing.T) {
	for _, stderr := range []string{
		"fatal: reference is not a tree: bogus",
		"fatal: invalid reference: notabranch",
		"fatal: bad object abc123",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "NotFound" {
			t.Fatalf("%q -> %q, want NotFound", stderr, kind)
		}
	}
}

func TestClassifyOpError_LockHeld(t *testing.T) {
	for _, stderr := range []string{
		"fatal: Unable to create '/repo/.git/index.lock': File exists.",
		"fatal: Unable to create '/repo/.git/refs/heads/foo.lock': Another git process seems to be running in this repository.",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "LockHeld" {
			t.Fatalf("%q -> %q, want LockHeld", stderr, kind)
		}
	}
}

func TestClassifyOpError_Unknown(t *testing.T) {
	if kind, _ := gitops.ClassifyOpError("fatal: something entirely unrecognised happened", 1); kind != "Unknown" {
		t.Fatalf("got %q", kind)
	}
}

// TestClassifyOpError_WorktreeDeleteNotNotFullyMerged is D18's first ordering assertion, named
// explicitly: a worktree-conflict delete must never be misread as NotFullyMerged.
func TestClassifyOpError_WorktreeDeleteNotNotFullyMerged(t *testing.T) {
	stderr := "error: cannot delete branch 'feature2' used by worktree at '/tmp/g5b-wt'"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "WorktreeConflict" {
		t.Fatalf("got %q, want WorktreeConflict (not NotFullyMerged)", kind)
	}
}
