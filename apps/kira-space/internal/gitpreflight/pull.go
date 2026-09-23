package gitpreflight

import "strings"

// PullStrategy mirrors @kira/git-ipc's own PullStrategy union verbatim.
type PullStrategy string

const (
	PullFFOnly PullStrategy = "ff-only"
	PullMerge  PullStrategy = "merge"
	PullRebase PullStrategy = "rebase"
)

// PullStrategySource mirrors @kira/git-ipc's own PullStrategySource union — where a resolved
// strategy came from, so the UI can say so before running it (§7.3).
type PullStrategySource string

const (
	SourceExplicit     PullStrategySource = "explicit"
	SourceSetting      PullStrategySource = "setting"
	SourceBranchConfig PullStrategySource = "branchConfig"
	SourcePullConfig   PullStrategySource = "pullConfig"
	SourceDefault      PullStrategySource = "default"
)

// PullRoute mirrors @kira/git-ipc's own PullRoute — one member, P9's own autostash seam.
type PullRoute string

const RouteStashAndCarry PullRoute = "stashAndCarry"

// PullBlocker mirrors @kira/git-ipc's own PullBlocker — one member.
type PullBlocker string

const BlockerDirtyNonFastForward PullBlocker = "dirtyNonFastForward"

// PullPreflight mirrors @kira/git-ipc's own PullPreflight field for field (D5's encoding rule).
type PullPreflight struct {
	Strategy PullStrategy       `json:"strategy"`
	Source   PullStrategySource `json:"source"`
	Upstream *string            `json:"upstream"`
	Ahead    int                `json:"ahead"`
	Behind   int                `json:"behind"`
	Dirty    bool               `json:"dirty"`
	Routes   []PullRoute        `json:"routes"`
	Blockers []PullBlocker      `json:"blockers"`
}

// PullConfigValues is the strategy ladder's own raw (still git-syntax) values of the three config
// keys steps 3-5 read, all from one `git config --null --get-regexp` spawn (gitops.PullConfigArgs,
// F16). nil when that key is unset.
type PullConfigValues struct {
	// BranchRebase is `branch.<name>.rebase` — "true"/"false"/"interactive"/"merges".
	BranchRebase *string
	// PullRebase is `pull.rebase` — same value space as BranchRebase.
	PullRebase *string
	// PullFf is `pull.ff` — only "only" changes the resolution.
	PullFf *string
}

// MapRebaseValue maps a raw `branch.<name>.rebase`/`pull.rebase` config value onto a PullStrategy:
// true (and its own synonyms) or interactive/merges -> rebase, false (and its own synonyms) ->
// merge; anything else (including an unrecognised string, or nil) is not a decision this key
// makes, ok is false. Exported (P108 Part 15 F6 fix) so gitsession's own executor can re-derive
// the SAME precedence decision at pull-execution time (wantsRebaseMerges, remote.go) without
// duplicating this table.
//
// F6 fix: git itself accepts boolean synonyms case-insensitively — `git_config_bool`'s own
// accepted spellings are yes/on/1 (true) and no/off/0 (false), alongside true/false themselves —
// plus the short forms `i` (interactive) and `m` (merges). Before this fix, only the four exact
// strings "true"/"false"/"interactive"/"merges" were recognised, so e.g. `pull.rebase=yes` fell
// through to this key making no decision at all, silently landing on the ff-only default instead
// of rebasing as configured.
func MapRebaseValue(raw *string) (PullStrategy, bool) {
	if raw == nil {
		return "", false
	}
	switch strings.ToLower(*raw) {
	case "false", "no", "off", "0":
		return PullMerge, true
	case "true", "yes", "on", "1", "interactive", "i", "merges", "m":
		return PullRebase, true
	default:
		return "", false
	}
}

// WantsRebaseMerges reports whether raw (the SAME `branch.<name>.rebase`/`pull.rebase` value
// MapRebaseValue above already classified as PullRebase) specifically asked for `--rebase-merges`
// rather than a plain rebase (F6): git's own "merges"/"m" shorthand preserves merge commits during
// the rebase instead of linearizing them away. Kept as its own function, not folded into
// MapRebaseValue's own return: PullStrategy's wire union stays exactly the three values
// @kira/git-ipc already declares (widening it to a fourth is a git-ipc contract change, Part 17's
// own boundary) — gitsession's own executor re-reads this SAME config value a second time, right
// before the rebase actually runs, and asks this function instead (remote.go's own
// wantsRebaseMerges).
func WantsRebaseMerges(raw *string) bool {
	if raw == nil {
		return false
	}
	switch strings.ToLower(*raw) {
	case "merges", "m":
		return true
	default:
		return false
	}
}

// ResolvePullStrategy is D18's six-step, first-match-wins ladder, ported from preflight/pull.ts's
// own resolvePullStrategy:
//  1. an explicit choice for this one invocation
//  2. settingStrategy, unless "auto" (or "")
//  3. branch.<name>.rebase
//  4. pull.rebase
//  5. pull.ff=only
//  6. fallback: ff-only
func ResolvePullStrategy(explicit *PullStrategy, settingStrategy string, cfg PullConfigValues) (PullStrategy, PullStrategySource) {
	if explicit != nil {
		return *explicit, SourceExplicit
	}
	if settingStrategy != "" && settingStrategy != "auto" {
		return PullStrategy(settingStrategy), SourceSetting
	}
	if s, ok := MapRebaseValue(cfg.BranchRebase); ok {
		return s, SourceBranchConfig
	}
	if s, ok := MapRebaseValue(cfg.PullRebase); ok {
		return s, SourcePullConfig
	}
	if cfg.PullFf != nil && *cfg.PullFf == "only" {
		return PullFFOnly, SourcePullConfig
	}
	return PullFFOnly, SourceDefault
}

// ClassifyPullInput is ClassifyPull's own input.
type ClassifyPullInput struct {
	Strategy      PullStrategy
	Source        PullStrategySource
	Upstream      *string
	Ahead, Behind int
	Dirty         bool
}

// ClassifyPull is §7.3's pull pre-flight, ported from preflight/pull.ts's own buildPullPreflight.
// `routes` carries `stashAndCarry` whenever any blocker exists (F19: the only PullBlocker there is
// dirtyNonFastForward, so "the only blocker is dirtyNonFastForward" reduces to "there is a
// blocker at all") — G12 is what makes that route actually runnable; this phase computes the
// blocker faithfully regardless (D18).
func ClassifyPull(in ClassifyPullInput) PullPreflight {
	diverged := in.Behind > 0 && in.Ahead > 0
	wouldRewriteHistory := in.Strategy != PullFFOnly && (diverged || in.Behind > 0)

	blockers := []PullBlocker{}
	if in.Dirty && wouldRewriteHistory {
		blockers = append(blockers, BlockerDirtyNonFastForward)
	}
	routes := []PullRoute{}
	if len(blockers) > 0 {
		routes = append(routes, RouteStashAndCarry)
	}

	return PullPreflight{
		Strategy: in.Strategy, Source: in.Source, Upstream: in.Upstream,
		Ahead: in.Ahead, Behind: in.Behind, Dirty: in.Dirty,
		Routes: routes, Blockers: blockers,
	}
}
