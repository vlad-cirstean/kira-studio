package gitpreflight_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
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

// TestMapRebaseValue_GitOwnSynonyms is P108 Part 15 F6's own regression proof: git's own
// git_config_bool accepts these synonyms case-insensitively, and "i"/"m" as interactive/merges'
// own short forms — before this fix, only the four exact strings "true"/"false"/"interactive"/
// "merges" were recognised, so e.g. pull.rebase=yes silently fell through to the ff-only default.
func TestMapRebaseValue_GitOwnSynonyms(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw  string
		want gitpreflight.PullStrategy
	}{
		{"yes", gitpreflight.PullRebase},
		{"On", gitpreflight.PullRebase},
		{"1", gitpreflight.PullRebase},
		{"True", gitpreflight.PullRebase},
		{"i", gitpreflight.PullRebase},
		{"m", gitpreflight.PullRebase},
		{"no", gitpreflight.PullMerge},
		{"Off", gitpreflight.PullMerge},
		{"0", gitpreflight.PullMerge},
		{"False", gitpreflight.PullMerge},
	}
	for _, c := range cases {
		strategy, ok := gitpreflight.MapRebaseValue(&c.raw)
		if !ok || strategy != c.want {
			t.Fatalf("MapRebaseValue(%q) = (%q, %v), want (%q, true)", c.raw, strategy, ok, c.want)
		}
	}
}

// TestWantsRebaseMerges is F6's own second regression proof: "merges"/"m" must additionally signal
// --rebase-merges, not just an ordinary PullRebase strategy — matched case-insensitively, same as
// MapRebaseValue's own synonyms.
func TestWantsRebaseMerges(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"merges", "Merges", "m", "M"} {
		if !gitpreflight.WantsRebaseMerges(&raw) {
			t.Fatalf("WantsRebaseMerges(%q) = false, want true", raw)
		}
	}
	for _, raw := range []string{"true", "interactive", "false", ""} {
		if gitpreflight.WantsRebaseMerges(&raw) {
			t.Fatalf("WantsRebaseMerges(%q) = true, want false", raw)
		}
	}
	if gitpreflight.WantsRebaseMerges(nil) {
		t.Fatal("WantsRebaseMerges(nil) = true, want false")
	}
}

// TestResolveRebaseMerges is P111's own table test: strategy x source x two config keys is a
// decision structure with interacting rules, replacing five real-git subtests gitsession's own
// now-deleted executor-side re-derivation once ran through I/O.
func TestResolveRebaseMerges(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		strategy gitpreflight.PullStrategy
		source   gitpreflight.PullStrategySource
		cfg      gitpreflight.PullConfigValues
		want     bool
	}{
		{
			name: "rebase/pullConfig/pull.rebase=merges", strategy: gitpreflight.PullRebase,
			source: gitpreflight.SourcePullConfig, cfg: gitpreflight.PullConfigValues{PullRebase: strp("merges")},
			want: true,
		},
		{
			name: "rebase/pullConfig/pull.rebase=m", strategy: gitpreflight.PullRebase,
			source: gitpreflight.SourcePullConfig, cfg: gitpreflight.PullConfigValues{PullRebase: strp("m")},
			want: true,
		},
		{
			name: "rebase/branchConfig/branch.x.rebase=merges", strategy: gitpreflight.PullRebase,
			source: gitpreflight.SourceBranchConfig, cfg: gitpreflight.PullConfigValues{BranchRebase: strp("merges")},
			want: true,
		},
		{
			name:     "rebase/branchConfig/branch.x.rebase=true wins over pull.rebase=merges (not the winning key)",
			strategy: gitpreflight.PullRebase, source: gitpreflight.SourceBranchConfig,
			cfg:  gitpreflight.PullConfigValues{BranchRebase: strp("true"), PullRebase: strp("merges")},
			want: false,
		},
		{
			name:     "rebase/setting/both keys merges -- the setting, not config, decided to rebase",
			strategy: gitpreflight.PullRebase, source: gitpreflight.SourceSetting,
			cfg:  gitpreflight.PullConfigValues{BranchRebase: strp("merges"), PullRebase: strp("merges")},
			want: false,
		},
		{
			name:     "rebase/explicit/both keys merges -- an explicit pick, not config, decided to rebase",
			strategy: gitpreflight.PullRebase, source: gitpreflight.SourceExplicit,
			cfg:  gitpreflight.PullConfigValues{BranchRebase: strp("merges"), PullRebase: strp("merges")},
			want: false,
		},
		{
			name: "rebase/default/nothing set", strategy: gitpreflight.PullRebase,
			source: gitpreflight.SourceDefault, cfg: gitpreflight.PullConfigValues{}, want: false,
		},
		{
			name: "merge/pullConfig/pull.rebase=false -- not a rebase at all", strategy: gitpreflight.PullMerge,
			source: gitpreflight.SourcePullConfig, cfg: gitpreflight.PullConfigValues{PullRebase: strp("false")},
			want: false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := gitpreflight.ResolveRebaseMerges(c.strategy, c.source, c.cfg)
			if got != c.want {
				t.Fatalf("ResolveRebaseMerges(%q, %q, %+v) = %v, want %v", c.strategy, c.source, c.cfg, got, c.want)
			}
		})
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
