package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// logLevelSettingKey is the one leaf G18 D14 collapses onto the sentinel repo id — kept as a
// named constant so the substitution below (and every doc comment referencing it) never risks the
// magic string drifting out of step with itself.
const logLevelSettingKey = "logLevel"

// worktreePrepareScriptKey/worktreeBasePathKey are G25 D10's own two new leaves — ordinary
// per-repo rows, no sentinel substitution (unlike logLevel).
const (
	worktreePrepareScriptKey = "worktreePrepareScript"
	worktreeBasePathKey      = "worktreeBasePath"
)

// sentinelRepoID is D14's reserved, permanently collision-free non-repo key: internal/gitclient/
// repo.go's RepoID is always a non-empty absolute path (or git-dir path for a bare repo), so ""
// can never collide with a real one.
const sentinelRepoID = ""

// GitRepoSettingsRepo reads and writes the `git_repo_settings` table — G18 D3's per-repo sibling
// of SettingsRepo, one JSON-valued row per (repo_id, key) leaf rather than a blob per repository.
type GitRepoSettingsRepo struct {
	DB *sql.DB
}

const gitRepoSettingsSelectSQL = `SELECT key, value FROM git_repo_settings WHERE repo_id = ?`

// resolveRepoID is G18 D14's whole special case, in one place: every key behaves exactly as the
// caller's own repoID says, except logLevelSettingKey, which is silently redirected to the
// sentinel row regardless of which real repo id was passed. Every caller above this repo — the
// RPC handlers, RepoSettingsState, the dialog's own request plumbing — passes a real repoId for
// every key, log.level included, and is never made aware this substitution happened.
func resolveRepoID(repoID, key string) string {
	if key == logLevelSettingKey {
		return sentinelRepoID
	}
	return repoID
}

// Get reads repoID's stored settings, falling back to model.DefaultGitRepoSettings() leaf by leaf
// for anything never written. logLevel is read from the sentinel row (D14), transparently to the
// caller — a Get(repoA) and a Get(repoB) return the identical logLevel whenever either has ever
// been Set.
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

	sentinelStored, err := r.selectAllFor(sentinelRepoID)
	if err != nil {
		return model.GitRepoSettings{}, err
	}
	leafValid(sentinelStored, logLevelSettingKey, &result.LogLevel, model.ValidLogLevel)

	return result, nil
}

// selectAllFor reads every stored leaf for one exact repo_id (the sentinel row included, when
// repoID == sentinelRepoID) — Get calls this twice, once for repoID's own rows and once for the
// sentinel row that carries logLevel, rather than reading every row in the table.
func (r *GitRepoSettingsRepo) selectAllFor(repoID string) (map[string]json.RawMessage, error) {
	rows, err := r.DB.Query(gitRepoSettingsSelectSQL, repoID)
	if err != nil {
		return nil, fmt.Errorf("repos/gitreposettings: query %s: %w", repoID, err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("repos/gitreposettings: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos/gitreposettings: rows: %w", err)
	}
	return stored, nil
}

// Set validates the patch, writes only the leaves the caller actually patched (D14's own
// resolveRepoID decides, per leaf, which repo_id row that lands in), and returns Get(repoID)
// afterwards — which, for logLevel, already reads back through the same sentinel substitution.
func (r *GitRepoSettingsRepo) Set(repoID string, patch model.GitRepoSettingsPatch) (model.GitRepoSettings, error) {
	if err := patch.Validate(); err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos/gitreposettings: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos/gitreposettings: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if patch.GraphPageSize != nil {
		if err := r.upsert(tx, repoID, "graphPageSize", *patch.GraphPageSize); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.GraphScope != nil {
		if err := r.upsert(tx, repoID, "graphScope", *patch.GraphScope); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.StashShowInGraph != nil {
		if err := r.upsert(tx, repoID, "stashShowInGraph", *patch.StashShowInGraph); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.StashIncludeUntracked != nil {
		if err := r.upsert(tx, repoID, "stashIncludeUntracked", *patch.StashIncludeUntracked); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.ReviewBaseCandidates != nil {
		if err := r.upsert(tx, repoID, "reviewBaseCandidates", *patch.ReviewBaseCandidates); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.PullStrategy != nil {
		if err := r.upsert(tx, repoID, "pullStrategy", *patch.PullStrategy); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.LogLevel != nil {
		// D14: resolveRepoID redirects this one write to the sentinel row regardless of repoID.
		if err := r.upsert(tx, repoID, logLevelSettingKey, *patch.LogLevel); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.GithubEnabled != nil {
		if err := r.upsert(tx, repoID, "githubEnabled", *patch.GithubEnabled); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.WorktreePrepareScript != nil {
		if err := r.upsert(tx, repoID, worktreePrepareScriptKey, *patch.WorktreePrepareScript); err != nil {
			return model.GitRepoSettings{}, err
		}
	}
	if patch.WorktreeBasePath != nil {
		if err := r.upsert(tx, repoID, worktreeBasePathKey, *patch.WorktreeBasePath); err != nil {
			return model.GitRepoSettings{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return model.GitRepoSettings{}, fmt.Errorf("repos/gitreposettings: commit: %w", err)
	}
	return r.Get(repoID)
}

func (r *GitRepoSettingsRepo) upsert(tx *sql.Tx, repoID, key string, value any) error {
	resolved := resolveRepoID(repoID, key)
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("repos/gitreposettings: encode %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO git_repo_settings (repo_id, key, value) VALUES (?, ?, ?)
		   ON CONFLICT(repo_id, key) DO UPDATE SET value = excluded.value`,
		resolved, key, string(encoded),
	); err != nil {
		return fmt.Errorf("repos/gitreposettings: upsert %s/%s: %w", resolved, key, err)
	}
	return nil
}
