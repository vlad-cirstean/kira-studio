package repos

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// AdeRepoConfigRepo reads and writes the per-repo ade config over code_repos. The prepare script and
// timeout are git_repo_settings leaves, not stored here.
type AdeRepoConfigRepo struct {
	DB *sql.DB
}

// List returns every code repo (sort order) joined with its ade config, integration branches and
// environments. A repo with no config row carries the column defaults.
func (r *AdeRepoConfigRepo) List() ([]model.AdeRepoConfig, error) {
	rows, err := r.DB.Query(`SELECT c.id, c.repo_id, c.name, c.root, COALESCE(a.nickname, ''), COALESCE(a.source, 'added')
		FROM code_repos c LEFT JOIN ade_repo_config a ON a.code_repo_id = c.id ORDER BY c.sort_order, c.id`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade repo config: %w", err)
	}
	out := make([]model.AdeRepoConfig, 0)
	idx := make(map[string]int)
	for rows.Next() {
		var c model.AdeRepoConfig
		if err := rows.Scan(&c.CodeRepoID, &c.RepoID, &c.Name, &c.Root, &c.Nickname, &c.Source); err != nil {
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
	rows, err := r.DB.Query(`SELECT f.path, f.watch, f.hidden, (SELECT COUNT(*) FROM ade_repo_config a WHERE a.source = f.path),
		(SELECT COUNT(*) FROM ade_repo_config a JOIN code_repos c ON c.id = a.code_repo_id
			WHERE a.source = f.path AND c.hidden = 1)
		FROM ade_folders f ORDER BY f.path`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade folders: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeFolder, 0)
	for rows.Next() {
		var f model.AdeFolder
		var watch, hidden int
		if err := rows.Scan(&f.Path, &watch, &hidden, &f.RepoCount, &f.HiddenCount); err != nil {
			return nil, fmt.Errorf("repos: scan ade folder: %w", err)
		}
		f.Watch = watch != 0
		f.Hidden = hidden != 0
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade folders rows: %w", err)
	}
	return out, nil
}

// ErrRepoConfigMissing reports a code repo id with no code_repos row.
var ErrRepoConfigMissing = errors.New("repos: code repo not found")

// Upsert applies patch to one repo in a single transaction: the config row, a dense rewrite of the
// integration branches, and the environments (removed names deleted, the rest upserted in place so
// their env state survives).
func (r *AdeRepoConfigRepo) Upsert(codeRepoID string, patch model.AdeRepoConfigPatch) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin ade repo config: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM code_repos WHERE id = ?`, codeRepoID).Scan(&exists); err != nil {
		return fmt.Errorf("repos: check code repo: %w", err)
	}
	if exists == 0 {
		return ErrRepoConfigMissing
	}
	if _, err := tx.Exec(`INSERT INTO ade_repo_config (code_repo_id) VALUES (?) ON CONFLICT(code_repo_id) DO NOTHING`, codeRepoID); err != nil {
		return fmt.Errorf("repos: ensure ade repo config: %w", err)
	}
	if patch.Nickname != nil {
		if _, err := tx.Exec(`UPDATE ade_repo_config SET nickname = ? WHERE code_repo_id = ?`, *patch.Nickname, codeRepoID); err != nil {
			return fmt.Errorf("repos: update nickname: %w", err)
		}
	}
	if patch.IntegrationBranches != nil {
		if _, err := tx.Exec(`DELETE FROM ade_repo_integration WHERE code_repo_id = ?`, codeRepoID); err != nil {
			return fmt.Errorf("repos: clear integration branches: %w", err)
		}
		for i, b := range *patch.IntegrationBranches {
			if _, err := tx.Exec(`INSERT INTO ade_repo_integration (code_repo_id, branch, position) VALUES (?, ?, ?)`, codeRepoID, b, i); err != nil {
				return fmt.Errorf("repos: insert integration branch: %w", err)
			}
		}
	}
	if patch.Environments != nil {
		if err := upsertEnvs(tx, codeRepoID, *patch.Environments); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit ade repo config: %w", err)
	}
	return nil
}

func upsertEnvs(tx *sql.Tx, codeRepoID string, envs []model.AdeRepoEnv) error {
	rows, err := tx.Query(`SELECT name FROM ade_repo_envs WHERE code_repo_id = ?`, codeRepoID)
	if err != nil {
		return fmt.Errorf("repos: query ade envs: %w", err)
	}
	var existing []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return fmt.Errorf("repos: scan ade env: %w", err)
		}
		existing = append(existing, n)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos: ade env rows: %w", err)
	}
	rows.Close()
	keep := make(map[string]bool, len(envs))
	for _, e := range envs {
		keep[e.Name] = true
	}
	for _, n := range existing {
		if !keep[n] {
			if _, err := tx.Exec(`DELETE FROM ade_repo_envs WHERE code_repo_id = ? AND name = ?`, codeRepoID, n); err != nil {
				return fmt.Errorf("repos: delete ade env: %w", err)
			}
		}
	}
	for i, e := range envs {
		if _, err := tx.Exec(`INSERT INTO ade_repo_envs (code_repo_id, name, deployed_sha_script, position) VALUES (?, ?, ?, ?)
			ON CONFLICT(code_repo_id, name) DO UPDATE SET deployed_sha_script = excluded.deployed_sha_script, position = excluded.position`,
			codeRepoID, e.Name, e.DeployedShaScript, i); err != nil {
			return fmt.Errorf("repos: upsert ade env: %w", err)
		}
	}
	return nil
}

// AddFolder inserts a watched folder; an existing path keeps its row and updates its watch flag.
func (r *AdeRepoConfigRepo) AddFolder(path string, watch bool) error {
	if _, err := r.DB.Exec(`INSERT INTO ade_folders (path, watch) VALUES (?, ?)
		ON CONFLICT(path) DO UPDATE SET watch = excluded.watch`, path, boolInt(watch)); err != nil {
		return fmt.Errorf("repos: add ade folder: %w", err)
	}
	return nil
}

// SetFolderWatch flips a folder's watch flag; false when the folder is unknown.
func (r *AdeRepoConfigRepo) SetFolderWatch(path string, watch bool) (bool, error) {
	res, err := r.DB.Exec(`UPDATE ade_folders SET watch = ? WHERE path = ?`, boolInt(watch), path)
	if err != nil {
		return false, fmt.Errorf("repos: set ade folder watch: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("repos: ade folder rows affected: %w", err)
	}
	return n > 0, nil
}

// SetFolderHidden sets the folder's hidden flag and writes it onto every repo it imported, in one
// transaction. False when the folder is unknown.
func (r *AdeRepoConfigRepo) SetFolderHidden(path string, hidden bool) (bool, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return false, fmt.Errorf("repos: begin set ade folder hidden: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	res, err := tx.Exec(`UPDATE ade_folders SET hidden = ? WHERE path = ?`, boolInt(hidden), path)
	if err != nil {
		return false, fmt.Errorf("repos: set ade folder hidden: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("repos: ade folder rows affected: %w", err)
	}
	if n == 0 {
		return false, nil
	}
	if _, err := tx.Exec(`UPDATE code_repos SET hidden = ? WHERE id IN
		(SELECT code_repo_id FROM ade_repo_config WHERE source = ?)`, boolInt(hidden), path); err != nil {
		return false, fmt.Errorf("repos: hide folder repos: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("repos: commit set ade folder hidden: %w", err)
	}
	return true, nil
}

// FolderHidden reports a folder's hidden flag; false for an unknown folder.
func (r *AdeRepoConfigRepo) FolderHidden(path string) (bool, error) {
	var hidden int
	err := r.DB.QueryRow(`SELECT hidden FROM ade_folders WHERE path = ?`, path).Scan(&hidden)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("repos: ade folder hidden: %w", err)
	}
	return hidden != 0, nil
}

// RemoveFolder deletes the folder row and moves its imported repos to source 'added', in one
// transaction. False when the folder is unknown.
func (r *AdeRepoConfigRepo) RemoveFolder(path string) (bool, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return false, fmt.Errorf("repos: begin remove ade folder: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	res, err := tx.Exec(`DELETE FROM ade_folders WHERE path = ?`, path)
	if err != nil {
		return false, fmt.Errorf("repos: delete ade folder: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("repos: ade folder rows affected: %w", err)
	}
	if n == 0 {
		return false, nil
	}
	if _, err := tx.Exec(`UPDATE ade_repo_config SET source = 'added' WHERE source = ?`, path); err != nil {
		return false, fmt.Errorf("repos: release folder repos: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("repos: commit remove ade folder: %w", err)
	}
	return true, nil
}

// SetSource records where a repo was imported from ('added' or a folder path).
func (r *AdeRepoConfigRepo) SetSource(codeRepoID, source string) error {
	if _, err := r.DB.Exec(`INSERT INTO ade_repo_config (code_repo_id, source) VALUES (?, ?)
		ON CONFLICT(code_repo_id) DO UPDATE SET source = excluded.source`, codeRepoID, source); err != nil {
		return fmt.Errorf("repos: set ade repo source: %w", err)
	}
	return nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
