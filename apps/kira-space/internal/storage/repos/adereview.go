package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// AdeReviewWindow is one row of `ade_review_windows`: an ephemeral review window and what it reviews.
type AdeReviewWindow struct {
	WindowKey string
	TaskID    string
	BranchID  string
	CreatedAt int64
}

// AdeReviewWindowsRepo reads and writes `ade_review_windows`. Its window rows live in `windows`,
// which cascades the delete.
type AdeReviewWindowsRepo struct {
	DB *sql.DB
}

// Insert adds the row; the caller created the `windows` row first.
func (r *AdeReviewWindowsRepo) Insert(w AdeReviewWindow) error {
	if _, err := r.DB.Exec(
		`INSERT INTO ade_review_windows (window_key, task_id, branch_id, created_at) VALUES (?, ?, ?, ?)`,
		w.WindowKey, w.TaskID, w.BranchID, w.CreatedAt,
	); err != nil {
		return fmt.Errorf("repos: insert review window %s: %w", w.WindowKey, err)
	}
	return nil
}

func scanReviewWindow(row rowScanner) (AdeReviewWindow, error) {
	var w AdeReviewWindow
	err := row.Scan(&w.WindowKey, &w.TaskID, &w.BranchID, &w.CreatedAt)
	return w, err
}

// ByBranch returns the branch's review window, (nil, nil) when none is open.
func (r *AdeReviewWindowsRepo) ByBranch(branchID string) (*AdeReviewWindow, error) {
	return sqlitex.QueryOne(r.DB, func(row *sql.Row) (*AdeReviewWindow, error) {
		w, err := scanReviewWindow(row)
		return &w, err
	}, `SELECT window_key, task_id, branch_id, created_at FROM ade_review_windows WHERE branch_id = ?`, branchID)
}

// ByKey returns the review window with this key, (nil, nil) when it is not one.
func (r *AdeReviewWindowsRepo) ByKey(key string) (*AdeReviewWindow, error) {
	return sqlitex.QueryOne(r.DB, func(row *sql.Row) (*AdeReviewWindow, error) {
		w, err := scanReviewWindow(row)
		return &w, err
	}, `SELECT window_key, task_id, branch_id, created_at FROM ade_review_windows WHERE window_key = ?`, key)
}

// KeysByTask lists the task's review window keys.
func (r *AdeReviewWindowsRepo) KeysByTask(taskID string) ([]string, error) {
	rows, err := r.DB.Query(`SELECT window_key FROM ade_review_windows WHERE task_id = ?`, taskID)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (string, bool, error) {
		var k string
		err := rows.Scan(&k)
		return k, true, err
	})
}

// IsReviewKey reports whether key names a review window.
func (r *AdeReviewWindowsRepo) IsReviewKey(key string) (bool, error) {
	w, err := r.ByKey(key)
	return w != nil, err
}

// PurgeAll deletes every review window's `windows` row (cascading its review row): review windows
// are never restored on relaunch.
func (r *AdeReviewWindowsRepo) PurgeAll() error {
	if _, err := r.DB.Exec(`DELETE FROM windows WHERE key IN (SELECT window_key FROM ade_review_windows)`); err != nil {
		return fmt.Errorf("repos: purge review windows: %w", err)
	}
	return nil
}

// DeleteByTask drops the task's review rows without touching `windows`.
func (r *AdeReviewWindowsRepo) DeleteByTask(taskID string) error {
	if _, err := r.DB.Exec(`DELETE FROM ade_review_windows WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("repos: delete review windows of task %s: %w", taskID, err)
	}
	return nil
}
