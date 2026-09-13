package gitops_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

func TestWorktreeAddExistingBranchArgs(t *testing.T) {
	t.Parallel()
	got := gitops.WorktreeAddExistingBranchArgs("../wt", "feature")
	want := []string{"worktree", "add", "--", "../wt", "feature"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestWorktreeAddNewBranchArgs(t *testing.T) {
	t.Parallel()
	got := gitops.WorktreeAddNewBranchArgs("../wt", "topic", "main")
	want := []string{"worktree", "add", "-b", "topic", "--", "../wt", "main"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestWorktreeAddDetachArgs(t *testing.T) {
	t.Parallel()
	got := gitops.WorktreeAddDetachArgs("../wt", "abc123")
	want := []string{"worktree", "add", "--detach", "--", "../wt", "abc123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestWorktreeRemoveArgs(t *testing.T) {
	t.Parallel()
	if got, want := gitops.WorktreeRemoveArgs("../wt", false), []string{"worktree", "remove", "../wt"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got, want := gitops.WorktreeRemoveArgs("../wt", true), []string{"worktree", "remove", "--force", "../wt"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
