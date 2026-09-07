package gitclient

// SettingsSnapshot mirrors packages/git-core/src/settings/schema.ts's SETTINGS defaults exactly —
// a structural copy, not an import (Go cannot import TypeScript), kept honest the same way
// contract.ts's own SettingsSnapshot is: by both sides being read against the same source rather
// than by a shared type. OQ-2 defers real settings-surface integration (a `git.*` key the user can
// actually edit); until then, app.init always answers with these fixed defaults.
type SettingsSnapshot struct {
	GitPath       string `json:"git.path"`
	GraphPageSize int    `json:"git.graph.pageSize"`
	GraphScope    string `json:"git.graph.scope"`
	LogLevel      string `json:"git.log.level"`
}

// DefaultSettings returns git-core's own SETTINGS defaults verbatim.
func DefaultSettings() SettingsSnapshot {
	return SettingsSnapshot{
		GitPath:       "",
		GraphPageSize: 5000,
		GraphScope:    "all",
		LogLevel:      "info",
	}
}

// RepoCandidate is one entry in repo.list's result — structurally matches @kira/git-ipc's own
// RepoCandidate.
type RepoCandidate struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}
