package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// worktreePrepareScriptKey/worktreeBasePathKey are G25 D10's own two new leaves — ordinary
// per-repo rows, same shape as every other leaf.
const (
	worktreePrepareScriptKey  = "worktreePrepareScript"
	worktreeBasePathKey       = "worktreeBasePath"
	worktreePrepareTimeoutKey = "worktreePrepareTimeout"
)

// checkoutAutoStashKey is G28 D16's own eleventh leaf (kiraSpace.checkout.autoStash) — same
// ordinary per-repo row shape as every other leaf here.
const checkoutAutoStashKey = "checkoutAutoStash"

// GitRepoSettingsRepo reads and writes the `git_repo_settings` table — G18 D3's per-repo sibling
// of SettingsRepo, one JSON-valued row per (repo_id, key) leaf rather than a blob per repository.
type GitRepoSettingsRepo struct {
	DB *sql.DB
}

const gitRepoSettingsSelectSQL = `SELECT key, value FROM git_repo_settings WHERE repo_id = ?`

// Get reads repoID's stored settings, falling back to model.DefaultGitRepoSettings() leaf by leaf
// for anything never written.
func (r *GitRepoSettingsRepo) Get(repoID string) (model.GitRepoSettings, error) {
	result := model.DefaultGitRepoSettings()

	stored, err := r.selectAllFor(repoID)
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	appsettings.LeafValid(stored, "graphPageSize", &result.GraphPageSize, func(v int) bool { return v >= 100 && v <= 50000 })
	appsettings.LeafValid(stored, "graphScope", &result.GraphScope, model.ValidGraphScope)
	appsettings.Leaf(stored, "stashShowInGraph", &result.StashShowInGraph)
	appsettings.Leaf(stored, "stashIncludeUntracked", &result.StashIncludeUntracked)
	appsettings.Leaf(stored, "reviewBaseCandidates", &result.ReviewBaseCandidates)
	appsettings.LeafValid(stored, "pullStrategy", &result.PullStrategy, model.ValidPullStrategy)
	appsettings.Leaf(stored, "githubEnabled", &result.GithubEnabled)
	appsettings.Leaf(stored, worktreePrepareScriptKey, &result.WorktreePrepareScript)
	appsettings.LeafValid(stored, worktreePrepareTimeoutKey, &result.WorktreePrepareTimeout, func(v string) bool {
		_, err := model.ParsePrepareTimeout(v)
		return err == nil
	})
	appsettings.Leaf(stored, worktreeBasePathKey, &result.WorktreeBasePath)
	appsettings.Leaf(stored, checkoutAutoStashKey, &result.CheckoutAutoStash)

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

// Set validates the patch, writes only the leaves the caller actually patched, and returns
// Get(repoID) afterwards.
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
		{"githubEnabled", patch.GithubEnabled != nil, derefAny(patch.GithubEnabled)},
		{worktreePrepareScriptKey, patch.WorktreePrepareScript != nil, derefAny(patch.WorktreePrepareScript)},
		{worktreePrepareTimeoutKey, patch.WorktreePrepareTimeout != nil, derefAny(patch.WorktreePrepareTimeout)},
		{worktreeBasePathKey, patch.WorktreeBasePath != nil, derefAny(patch.WorktreeBasePath)},
		{checkoutAutoStashKey, patch.CheckoutAutoStash != nil, derefAny(patch.CheckoutAutoStash)},
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
