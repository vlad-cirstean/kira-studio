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
