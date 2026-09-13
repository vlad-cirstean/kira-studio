package codeindex

import (
	"database/sql"
	"fmt"
	"time"
)

// idleRepoWindow is §5.4's own idle window — a repository untouched this long has its rows swept,
// the same idle window gitreview's own reaper uses.
const idleRepoWindow = 14 * 24 * time.Hour

// sweepIdleRepos deletes every repository whose meta.last_used_at is older than idleRepoWindow,
// called from ensureOpen on every lazy open (§5.4) — the same "sweep once per open" shape
// gitreview's own reaper uses. It runs against the raw *sql.DB, not through Store's own methods:
// ensureOpen already holds Store.openMu, and sync.Mutex is not reentrant, so calling back through
// Store.conn()/ensureOpen here would deadlock (gitreview/db.go's own ensureOpen documents the
// identical reason for its own startup sweep).
//
// Unlike a per-repository cache file, dropping an idle repository here has no instant-unlink
// equivalent — it is a cascading DELETE FROM file (§5.1's own stated tradeoff of a shared file:
// simpler operational story, a SQL delete instead of os.Remove); reclaiming the freed pages is
// `_auto_vacuum=INCREMENTAL`'s job, not this function's.
func sweepIdleRepos(db *sql.DB) error {
	cutoff := time.Now().Add(-idleRepoWindow).UnixMilli()

	rows, err := db.Query(`
		SELECT DISTINCT repo_id FROM meta
		WHERE key = 'last_used_at' AND CAST(value AS INTEGER) < ?`, cutoff)
	if err != nil {
		return fmt.Errorf("codeindex: query idle repos: %w", err)
	}
	var repoIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return fmt.Errorf("codeindex: scan idle repo id: %w", err)
		}
		repoIDs = append(repoIDs, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("codeindex: query idle repos: %w", err)
	}
	_ = rows.Close()

	for _, id := range repoIDs {
		if _, err := db.Exec(`DELETE FROM file WHERE repo_id = ?`, id); err != nil {
			return fmt.Errorf("codeindex: sweep idle repo %s files: %w", id, err)
		}
		if _, err := db.Exec(`DELETE FROM meta WHERE repo_id = ?`, id); err != nil {
			return fmt.Errorf("codeindex: sweep idle repo %s meta: %w", id, err)
		}
	}
	return nil
}
