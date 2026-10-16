package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// AdeGhSyncedRepo reads and writes `ade_gh_synced`: the files this app marked viewed on a PR, so an
// un-review unmarks only those.
type AdeGhSyncedRepo struct {
	DB *sql.DB
}

// Paths returns the branch's app-marked paths mapped to the PR number they were marked on.
func (r *AdeGhSyncedRepo) Paths(branchID string) (map[string]int, error) {
	rows, err := r.DB.Query(`SELECT path, pr_number FROM ade_gh_synced WHERE branch_id = ?`, branchID)
	type kv struct {
		p string
		n int
	}
	list, err := sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (kv, bool, error) {
		var x kv
		err := rows.Scan(&x.p, &x.n)
		return x, true, err
	})
	if err != nil {
		return nil, fmt.Errorf("repos: list gh synced of %s: %w", branchID, err)
	}
	out := make(map[string]int, len(list))
	for _, x := range list {
		out[x.p] = x.n
	}
	return out, nil
}

// Mark records that path was marked viewed on prNumber.
func (r *AdeGhSyncedRepo) Mark(branchID, path string, prNumber int, now int64) error {
	if _, err := r.DB.Exec(
		`INSERT INTO ade_gh_synced (branch_id, path, pr_number, marked_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (branch_id, path) DO UPDATE SET pr_number = excluded.pr_number, marked_at = excluded.marked_at`,
		branchID, path, prNumber, now,
	); err != nil {
		return fmt.Errorf("repos: record gh synced %s %s: %w", branchID, path, err)
	}
	return nil
}

// Unmark drops the record for path.
func (r *AdeGhSyncedRepo) Unmark(branchID, path string) error {
	if _, err := r.DB.Exec(`DELETE FROM ade_gh_synced WHERE branch_id = ? AND path = ?`, branchID, path); err != nil {
		return fmt.Errorf("repos: drop gh synced %s %s: %w", branchID, path, err)
	}
	return nil
}

// DeleteByTask drops every record of the task's branches (Archive; no GitHub call).
func (r *AdeGhSyncedRepo) DeleteByTask(taskID string) error {
	if _, err := r.DB.Exec(
		`DELETE FROM ade_gh_synced WHERE branch_id IN (SELECT id FROM ade_task_branches WHERE task_id = ?)`, taskID,
	); err != nil {
		return fmt.Errorf("repos: delete gh synced of task %s: %w", taskID, err)
	}
	return nil
}
