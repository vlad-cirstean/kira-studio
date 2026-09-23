package gitops_test

import (
	"regexp"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitops"
)

// TestPullConfigArgs_EscapesBranchName is P108 Part 15 F5's own regression proof: an unescaped
// branch name spliced into the `--get-regexp` pattern either silently matched the wrong key (an
// ERE metacharacter widens/narrows the match) or made `git config` exit 6 ("invalid key pattern")
// on an unbalanced one — a legal git refname either way.
func TestPullConfigArgs_EscapesBranchName(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, branch string
	}{
		// "|" has the lowest ERE binding precedence: unescaped, "branch.feat+x.rebase" (F5's own
		// probe) turns into "branch.feat, OR x.rebase" -- silently matching unrelated keys.
		{"contains a metacharacter with low ERE precedence", "feat+x"},
		// An unbalanced "(" makes `git config --get-regexp` itself exit 6 ("invalid key
		// pattern") when unescaped -- failing the whole PullPreflight, not just misclassifying it.
		{"contains an unbalanced paren", "a(b"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			argv := gitops.PullConfigArgs(tt.branch)
			if len(argv) != 4 || argv[0] != "config" || argv[1] != "--null" || argv[2] != "--get-regexp" {
				t.Fatalf("PullConfigArgs(%q) = %v, want config --null --get-regexp <pattern>", tt.branch, argv)
			}
			pattern := argv[3]
			re, err := regexp.Compile(pattern)
			if err != nil {
				t.Fatalf("PullConfigArgs(%q) produced an uncompilable pattern %q: %v", tt.branch, pattern, err)
			}
			// The escaped branch name must match only ITSELF, literally -- never a
			// differently-named branch.rebase key, and never anything outside branch.<name>.rebase.
			if !re.MatchString("branch." + tt.branch + ".rebase") {
				t.Fatalf("pattern %q must match branch.%s.rebase", pattern, tt.branch)
			}
			if re.MatchString("branch.unrelated.rebase") {
				t.Fatalf("pattern %q must not match an unrelated branch's own rebase key", pattern)
			}
			if re.MatchString("pull.somethingelse") {
				t.Fatalf("pattern %q must not match an unrelated pull.* key", pattern)
			}
		})
	}
}

// TestPullConfigArgs_OrdinaryBranchStillMatches confirms the fix is additive: an ordinary branch
// name (no metacharacters) still matches exactly the same three keys as before.
func TestPullConfigArgs_OrdinaryBranchStillMatches(t *testing.T) {
	t.Parallel()
	argv := gitops.PullConfigArgs("main")
	re := regexp.MustCompile(argv[3])
	for _, key := range []string{"pull.rebase", "pull.ff", "branch.main.rebase"} {
		if !re.MatchString(key) {
			t.Fatalf("pattern %q must match %q", argv[3], key)
		}
	}
	if re.MatchString("branch.other.rebase") {
		t.Fatalf("pattern %q must not match a different branch's own rebase key", argv[3])
	}
}
