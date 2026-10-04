package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// AdeRepoConfigRepo reads the per-repo ade config over code_repos. Write methods land with P145.
type AdeRepoConfigRepo struct {
	DB *sql.DB
}

// List returns every code repo (sort order) joined with its ade config, integration branches and
// environments. A repo with no config row carries the column defaults.
func (r *AdeRepoConfigRepo) List() ([]model.AdeRepoConfig, error) {
	rows, err := r.DB.Query(`SELECT c.id, c.name, c.root, COALESCE(a.nickname, ''), COALESCE(a.prepare_timeout, '10m'),
		COALESCE(a.source, 'added')
		FROM code_repos c LEFT JOIN ade_repo_config a ON a.code_repo_id = c.id ORDER BY c.sort_order, c.id`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade repo config: %w", err)
	}
	out := make([]model.AdeRepoConfig, 0)
	idx := make(map[string]int)
	for rows.Next() {
		var c model.AdeRepoConfig
		if err := rows.Scan(&c.CodeRepoID, &c.Name, &c.Root, &c.Nickname, &c.PrepareTimeout, &c.Source); err != nil {
			rows.Close()
			return nil, fmt.Errorf("repos: scan ade repo config: %w", err)
		}
		c.IntegrationBranches = make([]string, 0)
		c.Environments = make([]model.AdeRepoEnv, 0)
		idx[c.CodeRepoID] = len(out)
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("repos: ade repo config rows: %w", err)
	}
	rows.Close()

	irows, err := r.DB.Query(`SELECT code_repo_id, branch FROM ade_repo_integration ORDER BY code_repo_id, position`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade repo integration: %w", err)
	}
	for irows.Next() {
		var id, branch string
		if err := irows.Scan(&id, &branch); err != nil {
			irows.Close()
			return nil, fmt.Errorf("repos: scan ade repo integration: %w", err)
		}
		if i, ok := idx[id]; ok {
			out[i].IntegrationBranches = append(out[i].IntegrationBranches, branch)
		}
	}
	if err := irows.Err(); err != nil {
		irows.Close()
		return nil, fmt.Errorf("repos: ade repo integration rows: %w", err)
	}
	irows.Close()

	erows, err := r.DB.Query(`SELECT code_repo_id, name, deployed_sha_script FROM ade_repo_envs ORDER BY code_repo_id, position`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade repo envs: %w", err)
	}
	defer erows.Close()
	for erows.Next() {
		var id string
		var e model.AdeRepoEnv
		if err := erows.Scan(&id, &e.Name, &e.DeployedShaScript); err != nil {
			return nil, fmt.Errorf("repos: scan ade repo env: %w", err)
		}
		if i, ok := idx[id]; ok {
			out[i].Environments = append(out[i].Environments, e)
		}
	}
	if err := erows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade repo envs rows: %w", err)
	}
	return out, nil
}

// Folders returns every watched folder with its imported repo count (repos whose source is the path).
func (r *AdeRepoConfigRepo) Folders() ([]model.AdeFolder, error) {
	rows, err := r.DB.Query(`SELECT f.path, f.watch, (SELECT COUNT(*) FROM ade_repo_config a WHERE a.source = f.path)
		FROM ade_folders f ORDER BY f.path`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade folders: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeFolder, 0)
	for rows.Next() {
		var f model.AdeFolder
		var watch int
		if err := rows.Scan(&f.Path, &watch, &f.RepoCount); err != nil {
			return nil, fmt.Errorf("repos: scan ade folder: %w", err)
		}
		f.Watch = watch != 0
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade folders rows: %w", err)
	}
	return out, nil
}
