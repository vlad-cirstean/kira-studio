package gitpreflight_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// TestResolvePullStrategy_Ladder is D24's own six-rung matrix, one case per rung in order.
func TestResolvePullStrategy_Ladder(t *testing.T) {
	t.Parallel()
	t.Run("1 explicit wins over everything", func(t *testing.T) {
		explicit := gitpreflight.PullMerge
		strategy, source := gitpreflight.ResolvePullStrategy(&explicit, "rebase", gitpreflight.PullConfigValues{
			BranchRebase: strp("true"),
		})
		if strategy != gitpreflight.PullMerge || source != gitpreflight.SourceExplicit {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("2 setting wins over config, unless auto", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "rebase", gitpreflight.PullConfigValues{
			BranchRebase: strp("false"),
		})
		if strategy != gitpreflight.PullRebase || source != gitpreflight.SourceSetting {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("2b auto setting falls through to config", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "auto", gitpreflight.PullConfigValues{
			BranchRebase: strp("true"),
		})
		if strategy != gitpreflight.PullRebase || source != gitpreflight.SourceBranchConfig {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("3 branch.<name>.rebase", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{
			BranchRebase: strp("interactive"),
			PullRebase:   strp("false"),
		})
		if strategy != gitpreflight.PullRebase || source != gitpreflight.SourceBranchConfig {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("4 pull.rebase", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{
			PullRebase: strp("merges"),
			PullFf:     strp("only"),
		})
		if strategy != gitpreflight.PullRebase || source != gitpreflight.SourcePullConfig {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("5 pull.ff=only", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{
			PullFf: strp("only"),
		})
		if strategy != gitpreflight.PullFFOnly || source != gitpreflight.SourcePullConfig {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})

	t.Run("6 fallback is ff-only", func(t *testing.T) {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{})
		if strategy != gitpreflight.PullFFOnly || source != gitpreflight.SourceDefault {
			t.Fatalf("got (%q, %q)", strategy, source)
		}
	})
}

// TestResolvePullStrategy_BranchConfigValueMapping pins the value mapping itself: false -> merge,
// true/interactive/merges -> rebase, anything else -> not a decision this key makes.
func TestResolvePullStrategy_BranchConfigValueMapping(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw  string
		want gitpreflight.PullStrategy
	}{
		{"false", gitpreflight.PullMerge},
		{"true", gitpreflight.PullRebase},
		{"interactive", gitpreflight.PullRebase},
		{"merges", gitpreflight.PullRebase},
	}
	for _, c := range cases {
		strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{BranchRebase: strp(c.raw)})
		if strategy != c.want || source != gitpreflight.SourceBranchConfig {
			t.Fatalf("branch.rebase=%q: got (%q, %q), want (%q, branchConfig)", c.raw, strategy, source, c.want)
		}
	}
	// An unrecognised value makes no decision — falls through to the fallback.
	strategy, source := gitpreflight.ResolvePullStrategy(nil, "", gitpreflight.PullConfigValues{BranchRebase: strp("bogus")})
	if strategy != gitpreflight.PullFFOnly || source != gitpreflight.SourceDefault {
		t.Fatalf("got (%q, %q), want the ff-only fallback", strategy, source)
	}
}

func TestClassifyPull_CleanNoBlockers(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyPull(gitpreflight.ClassifyPullInput{
		Strategy: gitpreflight.PullFFOnly, Source: gitpreflight.SourceDefault, Dirty: true, Behind: 3,
	})
	if len(got.Blockers) != 0 || len(got.Routes) != 0 {
		t.Fatalf("ff-only never rewrites history, so a dirty tree is never blocked: %+v", got)
	}
}

func TestClassifyPull_DirtyNonFastForwardBlocks(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyPull(gitpreflight.ClassifyPullInput{
		Strategy: gitpreflight.PullMerge, Source: gitpreflight.SourceDefault, Dirty: true, Behind: 3,
	})
	if len(got.Blockers) != 1 || got.Blockers[0] != gitpreflight.BlockerDirtyNonFastForward {
		t.Fatalf("got %+v, want dirtyNonFastForward", got)
	}
	if len(got.Routes) != 1 || got.Routes[0] != gitpreflight.RouteStashAndCarry {
		t.Fatalf("got %+v, want the stashAndCarry route offered", got)
	}
}

func TestClassifyPull_CleanTreeNeverBlocksRegardlessOfStrategy(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyPull(gitpreflight.ClassifyPullInput{
		Strategy: gitpreflight.PullRebase, Source: gitpreflight.SourceDefault, Dirty: false, Behind: 3, Ahead: 2,
	})
	if len(got.Blockers) != 0 {
		t.Fatalf("got %+v, want no blockers for a clean tree", got)
	}
}
