package model

import "fmt"

// GitRepoSettings is G18 D3's seven display settings a user edits from the git graph's own
// dialog, moved out of VS Code's contributes.configuration entirely (D1). Six are genuinely
// per-repository facts; LogLevel is not (D14) — GitRepoSettingsRepo.Get/Set collapse it onto a
// reserved sentinel repo id regardless of which real repo id the caller passed, invisibly to
// every caller above that storage layer.
type GitRepoSettings struct {
	GraphPageSize         int      `json:"graphPageSize"`
	GraphScope            string   `json:"graphScope"`
	StashShowInGraph      bool     `json:"stashShowInGraph"`
	StashIncludeUntracked bool     `json:"stashIncludeUntracked"`
	ReviewBaseCandidates  []string `json:"reviewBaseCandidates"`
	PullStrategy          string   `json:"pullStrategy"`
	// LogLevel is instance-wide, not per-repo (D14) — see this struct's own doc comment.
	LogLevel string `json:"logLevel"`
	// GithubEnabled is G24 D16's own eighth leaf: off means no gh probe, no spawn, no cache fill, no
	// badge, no search PR arm, no reaper re-resolve — both commit.resolvePr/branch.resolvePr answer
	// {kind:'disabled'} outright. Genuinely per-repo (unlike LogLevel), default true.
	GithubEnabled bool `json:"githubEnabled"`
	// WorktreePrepareScript is G25 D10's own ninth leaf (kiraVersion.worktree.prepareScript): one
	// command-line string, never a path, never an argv array. "" means the feature is off — no
	// spawn, no shell, ever — the only value this leaf is EVER read from is this table; it must
	// never be sourced from `.git/config`, a tracked file, or any repo-carried convention (D10 —
	// the single highest-value safety property in the whole feature). Deliberately NOT validated
	// beyond being a string: it is shell text the user wrote, not a value this app parses.
	WorktreePrepareScript string `json:"worktreePrepareScript"`
	// WorktreeBasePath is G25 D10's own tenth leaf (kiraVersion.worktree.basePath) — pure UX, never
	// a security boundary: it only pre-fills WorktreeDialog's own path field. "" means no
	// suggestion beyond the dialog's own basename default.
	WorktreeBasePath string `json:"worktreeBasePath"`
	// CheckoutAutoStash is G28 D16's own eleventh leaf (kiraVersion.checkout.autoStash) — read
	// CLIENT-SIDE ONLY (the server never consults it, D16's own fail-safe-direction doc comment):
	// true means a blocked checkout is re-issued with autoStash:true instead of opening the old
	// CheckoutDialog. Default true.
	CheckoutAutoStash bool `json:"checkoutAutoStash"`
}

// DefaultGitRepoSettings mirrors packages/git-core/src/settings/schema.ts's own SETTINGS defaults
// for the seven keys that moved here (G18 D1).
func DefaultGitRepoSettings() GitRepoSettings {
	return GitRepoSettings{
		GraphPageSize:         5000,
		GraphScope:            "all",
		StashShowInGraph:      true,
		StashIncludeUntracked: false,
		ReviewBaseCandidates:  []string{"main", "master"},
		PullStrategy:          "auto",
		LogLevel:              "info",
		GithubEnabled:         true,
		WorktreePrepareScript: "",
		WorktreeBasePath:      "",
		CheckoutAutoStash:     true,
	}
}

// GitRepoSettingsPatch mirrors GitRepoSettings' own `.partial()` shape — every leaf optional,
// present only when the caller means to change it (the same discipline SettingsPatch/GitPatch
// already follow).
type GitRepoSettingsPatch struct {
	GraphPageSize         *int      `json:"graphPageSize,omitempty"`
	GraphScope            *string   `json:"graphScope,omitempty"`
	StashShowInGraph      *bool     `json:"stashShowInGraph,omitempty"`
	StashIncludeUntracked *bool     `json:"stashIncludeUntracked,omitempty"`
	ReviewBaseCandidates  *[]string `json:"reviewBaseCandidates,omitempty"`
	PullStrategy          *string   `json:"pullStrategy,omitempty"`
	LogLevel              *string   `json:"logLevel,omitempty"`
	GithubEnabled         *bool     `json:"githubEnabled,omitempty"`
	// WorktreePrepareScript/WorktreeBasePath: G25 D10's two new leaves.
	WorktreePrepareScript *string `json:"worktreePrepareScript,omitempty"`
	WorktreeBasePath      *string `json:"worktreeBasePath,omitempty"`
	// CheckoutAutoStash: G28 D16's own eleventh leaf.
	CheckoutAutoStash *bool `json:"checkoutAutoStash,omitempty"`
}

// ValidGraphScope mirrors schema.ts's kiraVersion.graph.scope enum.
func ValidGraphScope(v string) bool { return v == "all" || v == "head" }

// ValidPullStrategy mirrors schema.ts's kiraVersion.pull.strategy enum.
func ValidPullStrategy(v string) bool {
	switch v {
	case "auto", "ff-only", "merge", "rebase":
		return true
	default:
		return false
	}
}

// ValidLogLevel mirrors schema.ts's kiraVersion.log.level enum.
func ValidLogLevel(v string) bool {
	switch v {
	case "off", "error", "warn", "info", "debug":
		return true
	default:
		return false
	}
}

// validGraphPageSize mirrors schema.ts's kiraVersion.graph.pageSize bounds (100-50000).
var validGraphPageSize = InRange(100, 50000)

// Validate checks every leaf the caller actually patched against schema.ts's own bounds, naming
// the offending leaf in the error — the same discipline SettingsPatch.Validate follows.
func (p GitRepoSettingsPatch) Validate() error {
	if p.GraphPageSize != nil && !validGraphPageSize(*p.GraphPageSize) {
		return fmt.Errorf("model: graphPageSize: out of range value %d", *p.GraphPageSize)
	}
	if p.GraphScope != nil && !ValidGraphScope(*p.GraphScope) {
		return fmt.Errorf("model: graphScope: invalid value %q", *p.GraphScope)
	}
	if p.PullStrategy != nil && !ValidPullStrategy(*p.PullStrategy) {
		return fmt.Errorf("model: pullStrategy: invalid value %q", *p.PullStrategy)
	}
	if p.LogLevel != nil && !ValidLogLevel(*p.LogLevel) {
		return fmt.Errorf("model: logLevel: invalid value %q", *p.LogLevel)
	}
	return nil
}
