package gitops_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
)

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// TestReadInProgressStateFiles_AmMarker is P108 Part 15 F3's own regression proof at the I/O
// boundary: rebase-apply/applying's presence must be read into RebaseApplyApplying, and
// head-name/onto must be read from rebase-apply/ (not only rebase-merge/, which a plain `git am`
// or an apply-backend rebase never creates).
func TestReadInProgressStateFiles_AmMarker(t *testing.T) {
	t.Parallel()
	gitDir := t.TempDir()
	mustWriteFile(t, filepath.Join(gitDir, "rebase-apply", "applying"), "")
	mustWriteFile(t, filepath.Join(gitDir, "rebase-apply", "head-name"), "refs/heads/side\n")
	mustWriteFile(t, filepath.Join(gitDir, "rebase-apply", "onto"), "deadbeef\n")

	got := gitops.ReadInProgressStateFiles(gitDir)
	if !got.RebaseApplyDir || !got.RebaseApplyApplying {
		t.Fatalf("got = %+v, want RebaseApplyDir and RebaseApplyApplying both true", got)
	}
	if got.RebaseHeadName == nil || *got.RebaseHeadName != "refs/heads/side" {
		t.Fatalf("RebaseHeadName = %v, want refs/heads/side (read from rebase-apply/, not rebase-merge/)", got.RebaseHeadName)
	}
	if got.RebaseOnto == nil || *got.RebaseOnto != "deadbeef" {
		t.Fatalf("RebaseOnto = %v, want deadbeef", got.RebaseOnto)
	}
}

// TestReadInProgressStateFiles_ApplyBackendRebaseNoAmMarker confirms F3's fix is additive: an
// apply-backend rebase (rebase-apply/ present, no "applying" file) reads RebaseApplyApplying as
// false, unchanged from before the fix.
func TestReadInProgressStateFiles_ApplyBackendRebaseNoAmMarker(t *testing.T) {
	t.Parallel()
	gitDir := t.TempDir()
	mustWriteFile(t, filepath.Join(gitDir, "rebase-apply", "onto"), "onto-sha\n")

	got := gitops.ReadInProgressStateFiles(gitDir)
	if !got.RebaseApplyDir {
		t.Fatal("RebaseApplyDir = false, want true")
	}
	if got.RebaseApplyApplying {
		t.Fatal("RebaseApplyApplying = true, want false (no applying marker written)")
	}
}

// TestReadInProgressStateFiles_SequencerTodoKind is P108 Part 15 F2's own regression proof at the
// I/O boundary: sequencer/todo's first non-comment, non-blank line must be read into
// SequencerTodoKind so ClassifyInProgress can re-derive a paused revert/cherry-pick once every
// *_HEAD file is already gone.
func TestReadInProgressStateFiles_SequencerTodoKind(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		todo string
		want gitpreflight.InProgressKind
	}{
		{"revert", "revert 1234567 Some commit subject\n", gitpreflight.InProgressRevert},
		{"pick", "pick abcdef0 Another subject\n", gitpreflight.InProgressCherryPick},
		{
			"leading comment and blank line",
			"# Sequencer todo\n\nrevert abc0000 subject\npick def0000 subject2\n",
			gitpreflight.InProgressRevert,
		},
		{"unrecognised first command", "reset abc0000\n", ""},
		{"empty file", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gitDir := t.TempDir()
			mustWriteFile(t, filepath.Join(gitDir, "sequencer", "todo"), tt.todo)
			got := gitops.ReadInProgressStateFiles(gitDir)
			if !got.SequencerDir {
				t.Fatal("SequencerDir = false, want true")
			}
			if got.SequencerTodoKind != tt.want {
				t.Fatalf("SequencerTodoKind = %q, want %q", got.SequencerTodoKind, tt.want)
			}
		})
	}
}

// TestReadInProgressStateFiles_NoSequencerDir confirms the zero value (no sequencer/ at all —
// the common case) reads SequencerDir false and SequencerTodoKind "".
func TestReadInProgressStateFiles_NoSequencerDir(t *testing.T) {
	t.Parallel()
	got := gitops.ReadInProgressStateFiles(t.TempDir())
	if got.SequencerDir || got.SequencerTodoKind != "" {
		t.Fatalf("got = %+v, want SequencerDir false and SequencerTodoKind \"\"", got)
	}
}

// TestContinueArgs_Rebase and TestSkipArgs_Rebase are §7.1 item 5's own exit criterion: G26 D12
// gives rebase both a Continue and a Skip argv, retiring G5's "report-only posture".
func TestContinueArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.ContinueArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("ContinueArgs(InProgressRebase) ok = false, want true (G26 D12)")
	}
	if want := []string{"rebase", "--continue"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("ContinueArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

func TestSkipArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.SkipArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("SkipArgs(InProgressRebase) ok = false, want true (G26 D12)")
	}
	if want := []string{"rebase", "--skip"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("SkipArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

// TestAbortArgs_Rebase proves the pre-existing abort arm is untouched by this phase.
func TestAbortArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.AbortArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("AbortArgs(InProgressRebase) ok = false, want true")
	}
	if want := []string{"rebase", "--abort"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("AbortArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

// TestSkipArgs_BisectStillRefused proves the widening is scoped to exactly the three kinds D12
// names — bisect (no --skip in git) still answers ok=false.
func TestSkipArgs_BisectStillRefused(t *testing.T) {
	t.Parallel()
	if _, ok := gitops.SkipArgs(gitpreflight.InProgressBisect); ok {
		t.Fatal("SkipArgs(InProgressBisect) ok = true, want false")
	}
}
