package repos

import (
	"database/sql"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// Log kinds: a run log is keyed by run id, a worktree-setup log by branch id.
const (
	AdeLogRun   = "run"
	AdeLogSetup = "setup"
)

const (
	// AdeLogTailBytes is the tail kept per log; older chunks drop and set truncated.
	AdeLogTailBytes = 2 << 20
	// AdeLogChunkBytes caps one chunk; a longer line is cut with an ellipsis.
	AdeLogChunkBytes = 8 << 10
	adeLogPageLimit  = 500
)

// AdeLogChunk is one stored log chunk.
type AdeLogChunk struct {
	Seq    int
	At     int64
	Stream string
	Text   string
}

// AdeLogPage is one page of a log plus its counters.
type AdeLogPage struct {
	Chunks    []AdeLogChunk
	NextSeq   int
	Truncated bool
}

// AdeLogsRepo stores run and worktree-setup logs: the newest AdeLogTailBytes per log.
type AdeLogsRepo struct {
	DB *sql.DB
}

// Reset empties a log (creating it) and zeroes its counters.
func (r *AdeLogsRepo) Reset(kind, id, taskID string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin reset ade log: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.Exec(`DELETE FROM ade_log_chunks WHERE kind = ? AND id = ?`, kind, id); err != nil {
		return fmt.Errorf("repos: reset ade log chunks %s/%s: %w", kind, id, err)
	}
	if _, err := tx.Exec(`INSERT INTO ade_logs (kind, id, task_id, next_seq, bytes, truncated) VALUES (?, ?, ?, 1, 0, 0)
		ON CONFLICT(kind, id) DO UPDATE SET task_id = excluded.task_id, next_seq = 1, bytes = 0, truncated = 0`,
		kind, id, taskID); err != nil {
		return fmt.Errorf("repos: reset ade log %s/%s: %w", kind, id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit reset ade log: %w", err)
	}
	return nil
}

// Append stores chunks (Seq assigned here) in one transaction, dropping the oldest while the log
// exceeds AdeLogTailBytes, and returns the stored chunks with their seq. The log must exist (Reset).
func (r *AdeLogsRepo) Append(kind, id string, chunks []AdeLogChunk) ([]AdeLogChunk, error) {
	if len(chunks) == 0 {
		return nil, nil
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, fmt.Errorf("repos: begin append ade log: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	var next int
	var bytes int64
	var truncated int
	if err := tx.QueryRow(`SELECT next_seq, bytes, truncated FROM ade_logs WHERE kind = ? AND id = ?`, kind, id).Scan(&next, &bytes, &truncated); err != nil {
		return nil, fmt.Errorf("repos: read ade log %s/%s: %w", kind, id, err)
	}
	out := make([]AdeLogChunk, 0, len(chunks))
	for _, c := range chunks {
		c.Seq = next
		next++
		c.Text = clipChunk(c.Text)
		bytes += int64(len(c.Text))
		if _, err := tx.Exec(`INSERT INTO ade_log_chunks (kind, id, seq, at, stream, text) VALUES (?, ?, ?, ?, ?, ?)`,
			kind, id, c.Seq, c.At, c.Stream, c.Text); err != nil {
			return nil, fmt.Errorf("repos: append ade log chunk %s/%s: %w", kind, id, err)
		}
		out = append(out, c)
	}
	for bytes > AdeLogTailBytes {
		var seq, size int64
		err := tx.QueryRow(`SELECT seq, length(CAST(text AS BLOB)) FROM ade_log_chunks WHERE kind = ? AND id = ? ORDER BY seq LIMIT 1`, kind, id).Scan(&seq, &size)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("repos: read oldest ade log chunk %s/%s: %w", kind, id, err)
		}
		if _, err := tx.Exec(`DELETE FROM ade_log_chunks WHERE kind = ? AND id = ? AND seq = ?`, kind, id, seq); err != nil {
			return nil, fmt.Errorf("repos: drop ade log chunk %s/%s: %w", kind, id, err)
		}
		bytes -= size
		truncated = 1
	}
	if _, err := tx.Exec(`UPDATE ade_logs SET next_seq = ?, bytes = ?, truncated = ? WHERE kind = ? AND id = ?`, next, bytes, truncated, kind, id); err != nil {
		return nil, fmt.Errorf("repos: update ade log %s/%s: %w", kind, id, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("repos: commit append ade log: %w", err)
	}
	return out, nil
}

// clipChunk cuts text over AdeLogChunkBytes at a rune boundary and marks the cut.
func clipChunk(text string) string {
	if len(text) <= AdeLogChunkBytes {
		return text
	}
	cut := AdeLogChunkBytes - len("…")
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut] + "…"
}

// Page returns up to 500 chunks with seq > afterSeq. An unknown log reads as empty.
func (r *AdeLogsRepo) Page(kind, id string, afterSeq int) (AdeLogPage, error) {
	page := AdeLogPage{Chunks: []AdeLogChunk{}, NextSeq: afterSeq}
	var truncated int
	err := r.DB.QueryRow(`SELECT truncated FROM ade_logs WHERE kind = ? AND id = ?`, kind, id).Scan(&truncated)
	if errors.Is(err, sql.ErrNoRows) {
		return page, nil
	}
	if err != nil {
		return page, fmt.Errorf("repos: read ade log %s/%s: %w", kind, id, err)
	}
	page.Truncated = truncated != 0
	rows, err := r.DB.Query(`SELECT seq, at, stream, text FROM ade_log_chunks WHERE kind = ? AND id = ? AND seq > ? ORDER BY seq LIMIT ?`,
		kind, id, afterSeq, adeLogPageLimit)
	chunks, err := sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (AdeLogChunk, bool, error) {
		var c AdeLogChunk
		err := rows.Scan(&c.Seq, &c.At, &c.Stream, &c.Text)
		return c, true, err
	})
	if err != nil {
		return page, fmt.Errorf("repos: page ade log %s/%s: %w", kind, id, err)
	}
	for _, c := range chunks {
		page.Chunks = append(page.Chunks, c)
		page.NextSeq = c.Seq
	}
	return page, nil
}

// PurgeArchived deletes the logs of tasks archived at or before cutoff (Unix ms) and returns how many
// logs went. Chunks cascade; every other row stays. One task per statement keeps each write short.
func (r *AdeLogsRepo) PurgeArchived(cutoff int64) (int, error) {
	rows, err := r.DB.Query(`SELECT id FROM ade_tasks t WHERE archived_at IS NOT NULL AND archived_at <= ?
		AND EXISTS (SELECT 1 FROM ade_logs l WHERE l.task_id = t.id) ORDER BY id`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("repos: purge archived ade logs: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return 0, fmt.Errorf("repos: purge archived ade logs: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, fmt.Errorf("repos: purge archived ade logs: %w", err)
	}
	_ = rows.Close()
	removed := 0
	for _, id := range ids {
		res, err := r.DB.Exec(`DELETE FROM ade_logs WHERE task_id = ?`, id)
		if err != nil {
			return removed, fmt.Errorf("repos: purge ade logs of task %s: %w", id, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return removed, fmt.Errorf("repos: purge ade logs of task %s: %w", id, err)
		}
		removed += int(n)
	}
	if removed > 0 {
		if _, err := r.DB.Exec(`PRAGMA incremental_vacuum`); err != nil {
			return removed, fmt.Errorf("repos: incremental_vacuum after ade log purge: %w", err)
		}
	}
	return removed, nil
}
