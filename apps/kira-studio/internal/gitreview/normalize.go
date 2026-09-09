package gitreview

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpath"
)

// nonASCIIGlob is normalizeStoredPaths' own pre-filter (G27 D8): a GLOB matching any string
// containing a byte outside printable ASCII (0x20-0x7E). It is deliberately broad — it matches an
// already-correct NFC string just as readily as a stale NFD one — so the actual "does this need
// rewriting" decision is the gitpath.NFC(x) != x check in Go below, once a candidate is in hand.
// The point of the GLOB is only to keep the steady-state cost at one index-free scan that touches
// zero rows on an all-ASCII database, which is what makes this sweep safe to run unconditionally
// on every lazy-open rather than gated behind a schema version.
const nonASCIIGlob = `*[^ -~]*`

// normalizeStoredPaths re-keys review.db rows written before G27 normalized RepoID (D5a) and the
// worktree-path fields (D5c) to NFC. Idempotent — a second run against an already-normalized
// database finds nothing to do (every candidate's gitpath.NFC(x) already equals x) — and
// self-disabling on an all-ASCII database via nonASCIIGlob above, which is why it needs no schema
// version of its own and is called unconditionally from migrate() after the SQL migration loop.
//
// This is D2's one deliberate crossing of the tier-2 rule: review_file.path, review_range.path and
// review_comment.path are repository-relative file paths, normally never normalized (P7 — handed
// back to git as a pathspec would break the lookup). But a STORED review path is never handed to
// git directly — incremental.go always joins the live diff's own path against these stored rows as
// a lookup key (store.go's own out[rec.Path]), never the reverse — so normalizing the stored key to
// match what a post-D3 git will report for the same file is what KEEPS that join working, not what
// breaks it. The sweep only ever rewrites a stored path when gitpath.NFC(p) != p, i.e. exactly the
// rows a post-D3/D5 diff would otherwise fail to find a match for.
//
// review_file's PRIMARY KEY is (session_id, path) and review_range's is (session_id, path,
// start_line), with review_range's own FK on (session_id, path) REFERENCES review_file(session_id,
// path) — renaming that composite key from one side without the other, under review.db's own
// _foreign_keys=1 (db.go), is rejected immediately regardless of which side goes first. PRAGMA
// defer_foreign_keys defers that check to COMMIT instead of after each statement, which is exactly
// what lets this rename both sides of the FK inside one transaction. It applies only to the
// transaction it is set in and is cleared automatically at COMMIT/ROLLBACK — never a persisted
// setting, and never touching db.go's own always-on _foreign_keys=1 for every other connection.
func normalizeStoredPaths(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("gitreview: begin normalize: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once Commit has succeeded

	if _, err := tx.Exec(`PRAGMA defer_foreign_keys = ON`); err != nil {
		return fmt.Errorf("gitreview: normalize: defer_foreign_keys: %w", err)
	}

	if err := normalizeSessionRepoIDs(tx); err != nil {
		return err
	}
	if err := normalizeFileAndRangePaths(tx); err != nil {
		return err
	}
	if err := normalizeCommentPaths(tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("gitreview: commit normalize: %w", err)
	}
	return nil
}

// normalizeSessionRepoIDs re-keys review_session.repo_id (D2 tier 1 — an absolute repository
// path, F5). review_file/review_range/review_comment reference a session by its surrogate integer
// id, never by repo_id, so this rename touches no foreign key at all.
//
// UPDATE OR REPLACE's own conflict resolution is what collapses a collision (an NFD-keyed session
// and an already-NFC-keyed session for the same (repo_id, branch)) down to one row: the colliding
// existing row is deleted (cascading away ITS OWN review_file/range/comment children, D4's FK) and
// the renamed row takes its place — the documented, accepted cost of a genuine collision, which
// requires the same repository to have been reviewed under two different byte spellings of its own
// path, a narrow case.
func normalizeSessionRepoIDs(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT DISTINCT repo_id FROM review_session WHERE repo_id GLOB ?`, nonASCIIGlob)
	if err != nil {
		return fmt.Errorf("gitreview: normalize: query session repo_ids: %w", err)
	}
	var repoIDs []string
	for rows.Next() {
		var repoID string
		if err := rows.Scan(&repoID); err != nil {
			_ = rows.Close()
			return fmt.Errorf("gitreview: normalize: scan session repo_id: %w", err)
		}
		repoIDs = append(repoIDs, repoID)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("gitreview: normalize: iterate session repo_ids: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("gitreview: normalize: close session repo_ids: %w", err)
	}

	for _, repoID := range repoIDs {
		normalized := gitpath.NFC(repoID)
		if normalized == repoID {
			continue
		}
		if _, err := tx.Exec(`UPDATE OR REPLACE review_session SET repo_id = ? WHERE repo_id = ?`, normalized, repoID); err != nil {
			return fmt.Errorf("gitreview: normalize: rekey session repo_id: %w", err)
		}
	}
	return nil
}

// filePathKey is one (session_id, path) pair — review_file's own PK minus its non-key columns,
// and review_range/review_comment's own grouping key.
type filePathKey struct {
	sessionID int64
	path      string
}

// normalizeFileAndRangePaths re-keys review_file.path and review_range.path together (D8's one
// deliberate tier-2 crossing, see normalizeStoredPaths' own doc comment).
//
// review_file is renamed FIRST, review_range second — and this order is load-bearing, not
// cosmetic. review_range's own FK carries ON DELETE CASCADE: renaming review_file collides with a
// pre-existing already-NFC row often enough (D8's own "collision" case) that REPLACE's conflict
// resolution deletes that pre-existing row, which cascades away ITS OWN, still-decomposed-keyed
// review_range children too — so doing review_file's rename first, while the stale row's own
// review_range children are still safely parked under the OLD (still-unrenamed) key, is what keeps
// them from being caught in that same cascade. Renaming review_range second, once review_file has
// already landed on the composed key, then simply moves them into place with nothing left to
// collide with. (defer_foreign_keys, set by the caller, is what makes either order legal for the
// FK *check* itself — this ordering is about which rows a REPLACE-triggered cascade can still see,
// not about constraint enforcement timing.)
func normalizeFileAndRangePaths(tx *sql.Tx) error {
	keys, err := distinctFilePathKeys(tx, "review_file")
	if err != nil {
		return err
	}

	for _, k := range keys {
		normalized := gitpath.NFC(k.path)
		if normalized == k.path {
			continue
		}
		if _, err := tx.Exec(
			`UPDATE OR REPLACE review_file SET path = ? WHERE session_id = ? AND path = ?`,
			normalized, k.sessionID, k.path,
		); err != nil {
			return fmt.Errorf("gitreview: normalize: rekey review_file path: %w", err)
		}
		if _, err := tx.Exec(
			`UPDATE OR REPLACE review_range SET path = ? WHERE session_id = ? AND path = ?`,
			normalized, k.sessionID, k.path,
		); err != nil {
			return fmt.Errorf("gitreview: normalize: rekey review_range path: %w", err)
		}
	}
	return nil
}

// normalizeCommentPaths re-keys review_comment.path. Unlike review_file/review_range, path is not
// part of any PRIMARY KEY or UNIQUE constraint here (review_comment's own identity is its
// AUTOINCREMENT id, migrations/0002's own schema) — a plain UPDATE, no OR REPLACE, no collision to
// resolve, and every row sharing (session_id, path) is rewritten by one statement.
func normalizeCommentPaths(tx *sql.Tx) error {
	keys, err := distinctFilePathKeys(tx, "review_comment")
	if err != nil {
		return err
	}

	for _, k := range keys {
		normalized := gitpath.NFC(k.path)
		if normalized == k.path {
			continue
		}
		if _, err := tx.Exec(
			`UPDATE review_comment SET path = ? WHERE session_id = ? AND path = ?`,
			normalized, k.sessionID, k.path,
		); err != nil {
			return fmt.Errorf("gitreview: normalize: rekey review_comment path: %w", err)
		}
	}
	return nil
}

// distinctFilePathKeys reads every distinct (session_id, path) pair from table whose path matches
// nonASCIIGlob, fully materialised before any write — never an open cursor held across the UPDATEs
// that follow, both for SQLite locking and so a rewritten row can never be re-visited mid-scan.
func distinctFilePathKeys(tx *sql.Tx, table string) ([]filePathKey, error) {
	// table is one of the two literal, package-internal constants this file calls with — never
	// user input — so string-building the identifier here is not an injection risk.
	query := fmt.Sprintf(`SELECT DISTINCT session_id, path FROM %s WHERE path GLOB ?`, table)
	rows, err := tx.Query(query, nonASCIIGlob)
	if err != nil {
		return nil, fmt.Errorf("gitreview: normalize: query %s paths: %w", table, err)
	}
	var keys []filePathKey
	for rows.Next() {
		var k filePathKey
		if err := rows.Scan(&k.sessionID, &k.path); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("gitreview: normalize: scan %s path: %w", table, err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gitreview: normalize: iterate %s paths: %w", table, err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("gitreview: normalize: close %s paths: %w", table, err)
	}
	return keys, nil
}
