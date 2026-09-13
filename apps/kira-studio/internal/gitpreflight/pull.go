package gitpreflight

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

// mapRebaseValue maps true/interactive/merges -> rebase, false -> merge; anything else (including
// an unrecognised string, or nil) is not a decision this key makes.
func mapRebaseValue(raw *string) (PullStrategy, bool) {
	if raw == nil {
		return "", false
	}
	switch *raw {
	case "false":
		return PullMerge, true
	case "true", "interactive", "merges":
		return PullRebase, true
	default:
		return "", false
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
	if s, ok := mapRebaseValue(cfg.BranchRebase); ok {
		return s, SourceBranchConfig
	}
	if s, ok := mapRebaseValue(cfg.PullRebase); ok {
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
