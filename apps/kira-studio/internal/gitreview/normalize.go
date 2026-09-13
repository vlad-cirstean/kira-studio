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

// normalizeStoredPaths re-keys review_session.repo_id (D5a) to NFC — repo_id is an absolute
// repository DIRECTORY path, which this app's own filesystem-ingestion sites (G27 D5b-d) can
// legitimately hand it in NFD form (APFS/the fs watcher). Idempotent, self-disabling on an
// all-ASCII database via nonASCIIGlob above, which is why it needs no schema version of its own
// and is called unconditionally from migrate() after the SQL migration loop.
//
// G32 round-3 functional-correctness review, finding #6: this used to ALSO rewrite
// review_file.path, review_range.path and review_comment.path (normalizeFileAndRangePaths/
// normalizeCommentPaths, removed) on the premise that "a stored review path is only ever joined
// against what a post-D3 git will report for the same file [i.e. always NFC]." Verified false: D3
// (core.precomposeunicode) only affects how git READS filenames off the filesystem for its own
// internal comparisons — it does not touch what `git diff-tree`/`show` ECHO for a path already
// committed to the tree/index, which git returns byte-for-byte exactly as committed, forever. A
// repo containing a genuinely NFD-committed path (created on Linux, or copied in) reports that
// path NFD from every git command, this app's own repo_id notwithstanding — so unconditionally
// rewriting its stored review_file/range/comment rows to NFC, on the very next review.db open
// after they were written, silently broke incremental.go's own live-diff-path join and made that
// file's review state (and every comment on it) disappear. There is no way to tell, from inside
// this DB-only migration, "this stored NFD path is a historical artifact from before some earlier
// bug fix" apart from "this file's own commit history genuinely used NFD bytes" — the two are
// indistinguishable without consulting the live repository, which this function structurally has
// no access to — so the only safe fix is to never guess: these three columns are left exactly as
// git itself reported them, permanently.
func normalizeStoredPaths(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("gitreview: begin normalize: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once Commit has succeeded

	if err := normalizeSessionRepoIDs(tx); err != nil {
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
