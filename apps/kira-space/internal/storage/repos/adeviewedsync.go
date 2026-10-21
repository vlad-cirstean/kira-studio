package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// AdeViewedSyncRepo reads and writes `ade_viewed_sync`: the files this app marked viewed on a change
// request, so an un-review unmarks only those.
type AdeViewedSyncRepo struct {
	DB *sql.DB
}

// ViewedMark is the change request, on the named provider, a path was marked viewed on.
type ViewedMark struct {
	Number   int
	Provider string
}

// Paths returns the branch's app-marked paths mapped to the change request they were marked on.
func (r *AdeViewedSyncRepo) Paths(branchID string) (map[string]ViewedMark, error) {
	rows, err := r.DB.Query(`SELECT path, change_number, provider FROM ade_viewed_sync WHERE branch_id = ?`, branchID)
	type kv struct {
		p string
		m ViewedMark
	}
	list, err := sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (kv, bool, error) {
		var x kv
		err := rows.Scan(&x.p, &x.m.Number, &x.m.Provider)
		return x, true, err
	})
	if err != nil {
		return nil, fmt.Errorf("repos: list viewed sync of %s: %w", branchID, err)
	}
	out := make(map[string]ViewedMark, len(list))
	for _, x := range list {
		out[x.p] = x.m
	}
	return out, nil
}

// Mark records that path was marked viewed on change request number of provider.
func (r *AdeViewedSyncRepo) Mark(branchID, path, provider string, number int, now int64) error {
	if _, err := r.DB.Exec(
		`INSERT INTO ade_viewed_sync (branch_id, path, change_number, provider, marked_at) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (branch_id, path) DO UPDATE SET change_number = excluded.change_number, provider = excluded.provider, marked_at = excluded.marked_at`,
		branchID, path, number, provider, now,
	); err != nil {
		return fmt.Errorf("repos: record viewed sync %s %s: %w", branchID, path, err)
	}
	return nil
}

// Unmark drops the record for path.
func (r *AdeViewedSyncRepo) Unmark(branchID, path string) error {
	if _, err := r.DB.Exec(`DELETE FROM ade_viewed_sync WHERE branch_id = ? AND path = ?`, branchID, path); err != nil {
		return fmt.Errorf("repos: drop viewed sync %s %s: %w", branchID, path, err)
	}
	return nil
}

// DeleteByTask drops every record of the task's branches (Archive; no host call).
func (r *AdeViewedSyncRepo) DeleteByTask(taskID string) error {
	if _, err := r.DB.Exec(
		`DELETE FROM ade_viewed_sync WHERE branch_id IN (SELECT id FROM ade_task_branches WHERE task_id = ?)`, taskID,
	); err != nil {
		return fmt.Errorf("repos: delete viewed sync of task %s: %w", taskID, err)
	}
	return nil
}
