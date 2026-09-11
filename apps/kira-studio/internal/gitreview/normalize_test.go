package gitreview

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"
)

// decomposedE/composedE are the same byte literals gitpath_test.go uses (G27 D12) — every
// input in this file is built from them, never from the source file's own encoding.
var (
	normalizeDecomposedE = string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	normalizeComposedE   = string([]byte{0xc3, 0xa9})       // U+00E9, composed "é"
)

// TestNormalizeStoredPaths_RekeysRepoIDOnly is G32 round-3 functional-correctness review finding
// #6's own regression proof: review_session.repo_id (a filesystem DIRECTORY path, which this
// app's own ingestion sites can legitimately hand it in NFD) is still rekeyed to NFC, but
// review_file.path/review_range.path/review_comment.path (repository-relative paths sourced from
// git's own diff output, which echoes committed tree/index bytes verbatim regardless of
// core.precomposeunicode) are now left exactly as stored — rewriting them used to silently break
// incremental.go's own live-diff-path join for a genuinely NFD-committed file, making its review
// state (and every comment on it) disappear on the very next review.db open.
func TestNormalizeStoredPaths_RekeysRepoIDOnly(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	decomposedRepoID := "/repo/caf" + normalizeDecomposedE
	composedRepoID := "/repo/caf" + normalizeComposedE
	decomposedPath := "caf" + normalizeDecomposedE + ".txt"

	rec := FileRecord{
		Path: decomposedPath, State: "full", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000),
		BlobOID: "oid1", ContentKind: ContentBinary, Ranges: []LineRange{{Start: 1, End: 3}},
	}
	if err := s.Put(ctx, decomposedRepoID, "main", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if _, err := s.AddComment(ctx, decomposedRepoID, "main", Comment{
		Path: decomposedPath, Range: LineRange{Start: 1, End: 1}, Body: "hello",
		AnchorSHA: "sha1", AnchorBlobOID: "oid1", CreatedAt: time.UnixMilli(2000),
	}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	if err := normalizeStoredPaths(db); err != nil {
		t.Fatalf("normalizeStoredPaths: %v", err)
	}

	var repoID string
	if err := db.QueryRow(`SELECT repo_id FROM review_session`).Scan(&repoID); err != nil {
		t.Fatalf("select review_session.repo_id: %v", err)
	}
	if repoID != composedRepoID {
		t.Errorf("review_session.repo_id = %q, want composed %q", repoID, composedRepoID)
	}

	var filePath string
	if err := db.QueryRow(`SELECT path FROM review_file`).Scan(&filePath); err != nil {
		t.Fatalf("select review_file.path: %v", err)
	}
	if filePath != decomposedPath {
		t.Errorf("review_file.path = %q, want it left decomposed (%q) -- git's own diff output for "+
			"this file would still report it decomposed too", filePath, decomposedPath)
	}

	var rangePath string
	var start, end int
	if err := db.QueryRow(`SELECT path, start_line, end_line FROM review_range`).Scan(&rangePath, &start, &end); err != nil {
		t.Fatalf("select review_range: %v", err)
	}
	if rangePath != decomposedPath || start != 1 || end != 3 {
		t.Errorf("review_range = (%q, %d, %d), want (%q, 1, 3) -- left decomposed", rangePath, start, end, decomposedPath)
	}

	var commentPath, commentBody string
	if err := db.QueryRow(`SELECT path, body FROM review_comment`).Scan(&commentPath, &commentBody); err != nil {
		t.Fatalf("select review_comment: %v", err)
	}
	if commentPath != decomposedPath || commentBody != "hello" {
		t.Errorf("review_comment = (%q, %q), want (%q, %q) -- left decomposed", commentPath, commentBody, decomposedPath, "hello")
	}
}

// TestNormalizeStoredPaths_AllASCIIIsUntouched is D8/D12's third case: a database with no non-ASCII
// bytes anywhere is a pure no-op — the GLOB pre-filter matches nothing, so nothing is even a
// candidate for rewriting.
func TestNormalizeStoredPaths_AllASCIIIsUntouched(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	rec := FileRecord{
		Path: "plain.txt", State: "full", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000),
		BlobOID: "oid1", ContentKind: ContentBinary, Ranges: []LineRange{{Start: 1, End: 1}},
	}
	if err := s.Put(ctx, "plain-repo", "main", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if _, err := s.AddComment(ctx, "plain-repo", "main", Comment{
		Path: "plain.txt", Range: LineRange{Start: 1, End: 1}, Body: "fine as is",
		AnchorSHA: "sha1", AnchorBlobOID: "oid1", CreatedAt: time.UnixMilli(2000),
	}); err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	before := dumpNormalizeTables(t, db)

	if err := normalizeStoredPaths(db); err != nil {
		t.Fatalf("normalizeStoredPaths: %v", err)
	}

	after := dumpNormalizeTables(t, db)
	if before != after {
		t.Fatalf("an all-ASCII database changed after the sweep:\nbefore: %s\nafter:  %s", before, after)
	}
}

// TestNormalizeStoredPaths_SecondRunIsANoOp is D8/D12's fourth case: idempotence. Running the
// sweep again immediately after it has already rewritten everything makes no further change.
func TestNormalizeStoredPaths_SecondRunIsANoOp(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	decomposedPath := "caf" + normalizeDecomposedE + ".txt"
	rec := FileRecord{
		Path: decomposedPath, State: "full", ReviewedAtSHA: "sha1", ReviewedAt: time.UnixMilli(1000),
		BlobOID: "oid1", ContentKind: ContentBinary, Ranges: []LineRange{{Start: 1, End: 1}},
	}
	decomposedRepoID := "/repo/caf" + normalizeDecomposedE
	if err := s.Put(ctx, decomposedRepoID, "main", rec, nil); err != nil {
		t.Fatalf("Put: %v", err)
	}

	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	if err := normalizeStoredPaths(db); err != nil {
		t.Fatalf("normalizeStoredPaths (first run): %v", err)
	}
	afterFirst := dumpNormalizeTables(t, db)

	if err := normalizeStoredPaths(db); err != nil {
		t.Fatalf("normalizeStoredPaths (second run): %v", err)
	}
	afterSecond := dumpNormalizeTables(t, db)

	if afterFirst != afterSecond {
		t.Fatalf("a second sweep changed the database:\nafter first run:  %s\nafter second run: %s", afterFirst, afterSecond)
	}
}

// dumpNormalizeTables renders every row this package's normalize.go touches, in a stable order, as
// one comparable string — a before/after snapshot for the no-op and idempotence cases above.
func dumpNormalizeTables(t *testing.T, db *sql.DB) string {
	t.Helper()
	var b strings.Builder

	sessionRows, err := db.Query(`SELECT id, repo_id, branch FROM review_session ORDER BY id`)
	if err != nil {
		t.Fatalf("dump review_session: %v", err)
	}
	for sessionRows.Next() {
		var id int64
		var repoID, branch string
		if err := sessionRows.Scan(&id, &repoID, &branch); err != nil {
			t.Fatalf("scan review_session: %v", err)
		}
		fmt.Fprintf(&b, "session(%d,%q,%q)\n", id, repoID, branch)
	}
	if err := sessionRows.Err(); err != nil {
		t.Fatalf("iterate review_session: %v", err)
	}
	_ = sessionRows.Close()

	fileRows, err := db.Query(`SELECT session_id, path, state, reviewed_at_sha, blob_oid FROM review_file ORDER BY session_id, path`)
	if err != nil {
		t.Fatalf("dump review_file: %v", err)
	}
	for fileRows.Next() {
		var sessionID int64
		var path, state, sha, oid string
		if err := fileRows.Scan(&sessionID, &path, &state, &sha, &oid); err != nil {
			t.Fatalf("scan review_file: %v", err)
		}
		fmt.Fprintf(&b, "file(%d,%q,%q,%q,%q)\n", sessionID, path, state, sha, oid)
	}
	if err := fileRows.Err(); err != nil {
		t.Fatalf("iterate review_file: %v", err)
	}
	_ = fileRows.Close()

	rangeRows, err := db.Query(`SELECT session_id, path, start_line, end_line FROM review_range ORDER BY session_id, path, start_line`)
	if err != nil {
		t.Fatalf("dump review_range: %v", err)
	}
	for rangeRows.Next() {
		var sessionID int64
		var path string
		var start, end int
		if err := rangeRows.Scan(&sessionID, &path, &start, &end); err != nil {
			t.Fatalf("scan review_range: %v", err)
		}
		fmt.Fprintf(&b, "range(%d,%q,%d,%d)\n", sessionID, path, start, end)
	}
	if err := rangeRows.Err(); err != nil {
		t.Fatalf("iterate review_range: %v", err)
	}
	_ = rangeRows.Close()

	commentRows, err := db.Query(`SELECT session_id, path, body FROM review_comment ORDER BY session_id, path, id`)
	if err != nil {
		t.Fatalf("dump review_comment: %v", err)
	}
	for commentRows.Next() {
		var sessionID int64
		var path, body string
		if err := commentRows.Scan(&sessionID, &path, &body); err != nil {
			t.Fatalf("scan review_comment: %v", err)
		}
		fmt.Fprintf(&b, "comment(%d,%q,%q)\n", sessionID, path, body)
	}
	if err := commentRows.Err(); err != nil {
		t.Fatalf("iterate review_comment: %v", err)
	}
	_ = commentRows.Close()

	return b.String()
}
