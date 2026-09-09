package gitops_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

// TestStackConfigReadArgs is D1/probe P3's own byte-exact golden: --local (never a global-config
// leak), --null (the key\nvalue\0 framing parsePullConfig-shaped code already knows how to read),
// --get-regexp with the anchored branch.*.kirastack pattern.
func TestStackConfigReadArgs(t *testing.T) {
	got := gitops.StackConfigReadArgs()
	want := []string{"config", "--local", "--null", "--get-regexp", `^branch\..*\.kirastack`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("StackConfigReadArgs() = %v, want %v", got, want)
	}
}

func TestStackParentKeyAndBaseKey(t *testing.T) {
	if got, want := gitops.StackParentKey("feat"), "branch.feat.kirastackparent"; got != want {
		t.Fatalf("StackParentKey = %q, want %q", got, want)
	}
	if got, want := gitops.StackBaseKey("feat"), "branch.feat.kirastackbase"; got != want {
		t.Fatalf("StackBaseKey = %q, want %q", got, want)
	}
	// Probe P4: a branch name containing a dot must round-trip whole, never split.
	if got, want := gitops.StackParentKey("feat.x"), "branch.feat.x.kirastackparent"; got != want {
		t.Fatalf("StackParentKey(dotted) = %q, want %q", got, want)
	}
}

// TestStackConfigSetArgs_LocalPresent proves D2's own always-succeeding write shape: --local is
// present on every call, including the empty-string ("not stacked") case — the same argv shape for
// setting and for clearing, so undo replay never special-cases either direction.
func TestStackConfigSetArgs_LocalPresent(t *testing.T) {
	cases := []struct {
		name, key, value string
		want             []string
	}{
		{"set parent", "branch.feat2.kirastackparent", "feat1", []string{"config", "--local", "branch.feat2.kirastackparent", "feat1"}},
		{"clear parent (D2 empty string, never --unset)", "branch.feat2.kirastackparent", "", []string{"config", "--local", "branch.feat2.kirastackparent", ""}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := gitops.StackConfigSetArgs(c.key, c.value)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("StackConfigSetArgs(%q, %q) = %v, want %v", c.key, c.value, got, c.want)
			}
		})
	}
}

func TestMergeBaseArgs(t *testing.T) {
	got := gitops.MergeBaseArgs("main", "feat2")
	want := []string{"merge-base", "main", "feat2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("MergeBaseArgs() = %v, want %v", got, want)
	}
}

// TestRebaseOntoArgs_Golden is §7.1 item 3's own byte-exact golden: --no-autostash and
// --no-update-refs precede --onto, both are the explicit negative form (D6/D7), and the argument
// order is onto, upstream, branch.
func TestRebaseOntoArgs_Golden(t *testing.T) {
	got := gitops.RebaseOntoArgs("feat1", "abc123", "feat2")
	want := []string{"rebase", "--no-autostash", "--no-update-refs", "--onto", "feat1", "abc123", "feat2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RebaseOntoArgs() = %v, want %v", got, want)
	}
	// D7's defence-in-depth: the positive form must never appear anywhere in this argv.
	for _, arg := range got {
		if arg == "--update-refs" || arg == "--autostash" {
			t.Fatalf("RebaseOntoArgs() must never pass the positive form of either flag: %v", got)
		}
	}
}
