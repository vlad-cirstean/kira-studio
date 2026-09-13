package gitreview

import (
	"context"
	"fmt"
	"time"
)

// Comment is one review_comment row. Ranges are in AnchorSHA's own coordinates (D6's invariant)
// and are never rewritten — projection happens on read, in gitsession.
type Comment struct {
	ID            int64
	Path          string
	Range         LineRange
	Body          string
	AnchorSHA     string
	AnchorBlobOID string
	CreatedAt     time.Time
}

// AddComment inserts one comment, creating (repoID, branch)'s review_session row if this is the
// first thing ever recorded for it (D4) and bumping last_used_at either way. Returns the row with
// its assigned id — AUTOINCREMENT guarantees that id is never reused by a later insert even after
// this row is deleted (F10/probe P1), which is what makes it safe for a client to hold across a
// remove.
func (s *Store) AddComment(ctx context.Context, repoID, branch string, c Comment) (Comment, error) {
	db, err := s.conn()
	if err != nil {
		return Comment{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Comment{}, fmt.Errorf("gitreview: begin AddComment: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op once Commit has succeeded

	sessionID, err := upsertSession(ctx, tx, repoID, branch, time.Now().UnixMilli())
	if err != nil {
		return Comment{}, err
	}

	res, err := tx.ExecContext(ctx, `
		INSERT INTO review_comment
			(session_id, path, start_line, end_line, body, anchor_sha, anchor_blob_oid, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, sessionID, c.Path, c.Range.Start, c.Range.End, c.Body, c.AnchorSHA, c.AnchorBlobOID,
		c.CreatedAt.UnixMilli())
	if err != nil {
		return Comment{}, fmt.Errorf("gitreview: insert review_comment: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Comment{}, fmt.Errorf("gitreview: read review_comment id: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Comment{}, fmt.Errorf("gitreview: commit AddComment: %w", err)
	}
	c.ID = id
	return c, nil
}

// Comments returns every comment for (repoID, branch) in stored-coordinate order (path, start,
// end, created_at, id) — a stable starting point only: the authoritative order is applied by
// SortAnchored after projection, since projection can reorder two comments inside one file. nil
// (never an error) when no session exists for (repoID, branch).
func (s *Store) Comments(ctx context.Context, repoID, branch string) ([]Comment, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	id, ok, err := sessionID(ctx, db, repoID, branch)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}

	rows, err := db.QueryContext(ctx, `
		SELECT id, path, start_line, end_line, body, anchor_sha, anchor_blob_oid, created_at
		FROM review_comment WHERE session_id = ?
		ORDER BY path, start_line, end_line, created_at, id
	`, id)
	if err != nil {
		return nil, fmt.Errorf("gitreview: query review_comment: %w", err)
	}
	defer rows.Close()

	var out []Comment
	for rows.Next() {
		var c Comment
		var createdAtMillis int64
		if err := rows.Scan(&c.ID, &c.Path, &c.Range.Start, &c.Range.End, &c.Body,
			&c.AnchorSHA, &c.AnchorBlobOID, &createdAtMillis); err != nil {
			return nil, fmt.Errorf("gitreview: scan review_comment: %w", err)
		}
		c.CreatedAt = time.UnixMilli(createdAtMillis)
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gitreview: iterate review_comment: %w", err)
	}
	return out, nil
}

// RemoveComment deletes one comment, scoped to (repoID, branch)'s own session so an id belonging
// to another session matches nothing. false (not an error) when the row is already gone (D11) —
// two windows sharing one session is the designed state, not a client mistake.
func (s *Store) RemoveComment(ctx context.Context, repoID, branch string, id int64) (bool, error) {
	db, err := s.conn()
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, `
		DELETE FROM review_comment WHERE id = ? AND session_id = (
			SELECT id FROM review_session WHERE repo_id = ? AND branch = ?
		)
	`, id, repoID, branch)
	if err != nil {
		return false, fmt.Errorf("gitreview: delete review_comment: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("gitreview: read RowsAffected: %w", err)
	}
	return n > 0, nil
}

// ClearComments removes every comment for one session and nothing else — never a review_file, a
// review_range, or the session row itself (D14). Runs no incremental_vacuum (the sweep's and
// Purge's own job, D14). Returns how many were removed.
func (s *Store) ClearComments(ctx context.Context, repoID, branch string) (int, error) {
	db, err := s.conn()
	if err != nil {
		return 0, err
	}
	res, err := db.ExecContext(ctx, `
		DELETE FROM review_comment WHERE session_id = (
			SELECT id FROM review_session WHERE repo_id = ? AND branch = ?
		)
	`, repoID, branch)
	if err != nil {
		return 0, fmt.Errorf("gitreview: clear review_comment: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("gitreview: read RowsAffected: %w", err)
	}
	return int(n), nil
}
