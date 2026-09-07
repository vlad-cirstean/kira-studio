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

// G7 D14/F18: the eight remote rows, each pinned to a probe-observed message, plus D24's own three
// ordering assertions naming the exact row each would otherwise be swallowed by.

func TestClassifyOpError_HookRejected(t *testing.T) {
	// The non-porcelain stderr shape (probe P7's own note: "the same probe run WITHOUT
	// --porcelain puts ' ! [rejected] …' on stderr") — with --porcelain, ClassifyRemoteError's
	// own porcelainReason check (below) is what actually fires for a real push; this row is the
	// stderr-only fallback the table still names.
	stderr := " ! [rejected]        main -> main (pre-receive hook declined)"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "HookRejected" {
		t.Fatalf("got %q, want HookRejected", kind)
	}
}

func TestClassifyOpError_LeaseViolation(t *testing.T) {
	stderr := " ! [rejected]        main -> main (stale info)"
	kind, _ := gitops.ClassifyOpError(stderr, 1)
	if kind != "LeaseViolation" {
		t.Fatalf("got %q, want LeaseViolation — not NonFastForward (the ordering assertion)", kind)
	}
}

func TestClassifyOpError_RemoteRefUpdated(t *testing.T) {
	stderr := " ! [rejected]        main -> main (remote ref updated since checkout)"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "RemoteRefUpdated" {
		t.Fatalf("got %q, want RemoteRefUpdated", kind)
	}
}

func TestClassifyOpError_NonFastForward(t *testing.T) {
	// Probe P5's own no-porcelain form, plus `merge --ff-only`'s own real message against a
	// diverged branch (probed directly in this container, real git 2.43 — pull's own integrate
	// phase never has a porcelain reason to check first).
	for _, stderr := range []string{
		" ! [rejected]        main -> main (fetch first)",
		"fatal: Not possible to fast-forward, aborting.",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "NonFastForward" {
			t.Fatalf("%q -> %q, want NonFastForward", stderr, kind)
		}
	}
}

func TestClassifyOpError_AuthFailed(t *testing.T) {
	for _, stderr := range []string{
		"fatal: could not read Username for 'https://example.com': terminal prompts disabled",
		"error: unable to read askpass response from '/tmp/kira-askpass-x/shim'",
		"fatal: Authentication failed for 'https://example.com/repo.git/'",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "AuthFailed" {
			t.Fatalf("%q -> %q, want AuthFailed", stderr, kind)
		}
	}
}

func TestClassifyOpError_NetworkFailed(t *testing.T) {
	for _, stderr := range []string{
		"fatal: unable to access 'https://example.com/repo.git/': Could not resolve host: example.com",
		"ssh: connect to host example.com port 22: Connection refused",
	} {
		if kind, _ := gitops.ClassifyOpError(stderr, 128); kind != "NetworkFailed" {
			t.Fatalf("%q -> %q, want NetworkFailed", stderr, kind)
		}
	}
}

func TestClassifyOpError_RemoteNotFound(t *testing.T) {
	// The GitHub shape of RemoteNotFound — must not be swallowed by the local "not found" row.
	stderr := "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found"
	kind, _ := gitops.ClassifyOpError(stderr, 128)
	if kind != "RemoteNotFound" {
		t.Fatalf("got %q, want RemoteNotFound — not NotFound (the ordering assertion)", kind)
	}
}

func TestClassifyOpError_RemoteRefMissing(t *testing.T) {
	// Probe P8.
	stderr := "error: unable to delete 'fx': remote ref does not exist"
	if kind, _ := gitops.ClassifyOpError(stderr, 1); kind != "RemoteRefMissing" {
		t.Fatalf("got %q, want RemoteRefMissing", kind)
	}
}

func TestClassifyRemoteError_PorcelainReasonWinsOverStderr(t *testing.T) {
	kind, _ := gitops.ClassifyRemoteError("pre-receive hook declined", "error: failed to push some refs", 1)
	if kind != "HookRejected" {
		t.Fatalf("got %q, want HookRejected", kind)
	}
}

func TestClassifyRemoteError_EmptyPorcelainFallsThroughToStderr(t *testing.T) {
	// Probe P8: fetch and an empty porcelain block both carry "" for porcelainReason.
	kind, _ := gitops.ClassifyRemoteError("", "error: unable to delete 'fx': remote ref does not exist", 1)
	if kind != "RemoteRefMissing" {
		t.Fatalf("got %q, want RemoteRefMissing", kind)
	}
}
