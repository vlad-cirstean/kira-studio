package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// logLevelSettingKey names the one leaf that used to carry G18 D14's sentinel-row special case —
// kept as a named constant so the two ordinary reads/writes below (Get, Set) never risk the magic
// string drifting out of step with itself.
const logLevelSettingKey = "logLevel"

// worktreePrepareScriptKey/worktreeBasePathKey are G25 D10's own two new leaves — ordinary
// per-repo rows, same shape as every other leaf including logLevel now (P72 §9.2).
const (
	worktreePrepareScriptKey = "worktreePrepareScript"
	worktreeBasePathKey      = "worktreeBasePath"
)

// GitRepoSettingsRepo reads and writes the `git_repo_settings` table — G18 D3's per-repo sibling
// of SettingsRepo, one JSON-valued row per (repo_id, key) leaf rather than a blob per repository.
type GitRepoSettingsRepo struct {
	DB *sql.DB
}

const gitRepoSettingsSelectSQL = `SELECT key, value FROM git_repo_settings WHERE repo_id = ?`

// Get reads repoID's stored settings, falling back to model.DefaultGitRepoSettings() leaf by leaf
// for anything never written. logLevel is read from repoID's own row like every other leaf — the
// sentinel-row substitution G18 D14 gave it is deleted along with `instanceWide`'s only user;
// Kira Studio's own equivalent is now the independent, genuinely app-wide `advanced.gitLogLevel`
// (this app's own settings.go carries the same leaf).
func (r *GitRepoSettingsRepo) Get(repoID string) (model.GitRepoSettings, error) {
	result := model.DefaultGitRepoSettings()

	stored, err := r.selectAllFor(repoID)
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	leafValid(stored, "graphPageSize", &result.GraphPageSize, func(v int) bool { return v >= 100 && v <= 50000 })
	leafValid(stored, "graphScope", &result.GraphScope, model.ValidGraphScope)
	leaf(stored, "stashShowInGraph", &result.StashShowInGraph)
	leaf(stored, "stashIncludeUntracked", &result.StashIncludeUntracked)
	leaf(stored, "reviewBaseCandidates", &result.ReviewBaseCandidates)
	leafValid(stored, "pullStrategy", &result.PullStrategy, model.ValidPullStrategy)
	leaf(stored, "githubEnabled", &result.GithubEnabled)
	leaf(stored, worktreePrepareScriptKey, &result.WorktreePrepareScript)
	leaf(stored, worktreeBasePathKey, &result.WorktreeBasePath)
	leafValid(stored, logLevelSettingKey, &result.LogLevel, appsettings.ValidLogLevel)

	return result, nil
}

// selectAllFor reads every stored leaf for one exact repo_id.
func (r *GitRepoSettingsRepo) selectAllFor(repoID string) (map[string]json.RawMessage, error) {
	rows, err := r.DB.Query(gitRepoSettingsSelectSQL, repoID)
	if err != nil {
		return nil, fmt.Errorf("repos: query git repo settings %s: %w", repoID, err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("repos: scan git repo settings: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: git repo settings rows: %w", err)
	}
	return stored, nil
}

// Set validates the patch, writes only the leaves the caller actually patched (D14's own
// resolveRepoID decides, per leaf, which repo_id row that lands in), and returns Get(repoID)
// afterwards — which, for logLevel, already reads back through the same sentinel substitution.
func (r *GitRepoSettingsRepo) Set(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
	if err := patch.Validate(); err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos: begin git repo settings: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	// Every leaf here is the same three statements (has a value? upsert it), so one table plus
	// one loop replaces what used to be ten near-identical if-blocks.
	leaves := []struct {
		key   string
		has   bool
		value any
	}{
		{"graphPageSize", patch.GraphPageSize != nil, derefAny(patch.GraphPageSize)},
		{"graphScope", patch.GraphScope != nil, derefAny(patch.GraphScope)},
		{"stashShowInGraph", patch.StashShowInGraph != nil, derefAny(patch.StashShowInGraph)},
		{"stashIncludeUntracked", patch.StashIncludeUntracked != nil, derefAny(patch.StashIncludeUntracked)},
		{"reviewBaseCandidates", patch.ReviewBaseCandidates != nil, derefAny(patch.ReviewBaseCandidates)},
		{"pullStrategy", patch.PullStrategy != nil, derefAny(patch.PullStrategy)},
		{logLevelSettingKey, patch.LogLevel != nil, derefAny(patch.LogLevel)},
		{"githubEnabled", patch.GithubEnabled != nil, derefAny(patch.GithubEnabled)},
		{worktreePrepareScriptKey, patch.WorktreePrepareScript != nil, derefAny(patch.WorktreePrepareScript)},
		{worktreeBasePathKey, patch.WorktreeBasePath != nil, derefAny(patch.WorktreeBasePath)},
	}
	for _, l := range leaves {
		if !l.has {
			continue
		}
		if err := r.upsert(tx, repoID, l.key, l.value); err != nil {
			return model.GitRepoSettings{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos: commit git repo settings: %w", err)
	}
	return r.Get(repoID)
}

// derefAny dereferences a possibly-nil pointer for the leaves table above — nil stays nil rather
// than panicking, since the table always guards on `has` before a value is actually used.
func derefAny[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

func (r *GitRepoSettingsRepo) upsert(tx *sql.Tx, repoID, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("repos: encode git repo setting %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO git_repo_settings (repo_id, key, value) VALUES (?, ?, ?)
		   ON CONFLICT(repo_id, key) DO UPDATE SET value = excluded.value`,
		repoID, key, string(encoded),
	); err != nil {
		return fmt.Errorf("repos: upsert git repo setting %s/%s: %w", repoID, key, err)
	}
	return nil
}
