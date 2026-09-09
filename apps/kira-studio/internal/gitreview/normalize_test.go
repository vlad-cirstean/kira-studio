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

// TestNormalizeStoredPaths_RekeysSessionFileRangeAndComment is D8/D12's first case: every one of
// review_session.repo_id, review_file.path, review_range.path and review_comment.path, stored
// decomposed (as a pre-G27 build would have written them), comes back composed after one sweep —
// with review_range's own start/end and review_comment's own body surviving the rekey untouched.
func TestNormalizeStoredPaths_RekeysSessionFileRangeAndComment(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	decomposedRepoID := "/repo/caf" + normalizeDecomposedE
	composedRepoID := "/repo/caf" + normalizeComposedE
	decomposedPath := "caf" + normalizeDecomposedE + ".txt"
	composedPath := "caf" + normalizeComposedE + ".txt"

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
	if filePath != composedPath {
		t.Errorf("review_file.path = %q, want composed %q", filePath, composedPath)
	}

	var rangePath string
	var start, end int
	if err := db.QueryRow(`SELECT path, start_line, end_line FROM review_range`).Scan(&rangePath, &start, &end); err != nil {
		t.Fatalf("select review_range: %v", err)
	}
	if rangePath != composedPath || start != 1 || end != 3 {
		t.Errorf("review_range = (%q, %d, %d), want (%q, 1, 3)", rangePath, start, end, composedPath)
	}

	var commentPath, commentBody string
	if err := db.QueryRow(`SELECT path, body FROM review_comment`).Scan(&commentPath, &commentBody); err != nil {
		t.Fatalf("select review_comment: %v", err)
	}
	if commentPath != composedPath || commentBody != "hello" {
		t.Errorf("review_comment = (%q, %q), want (%q, %q)", commentPath, commentBody, composedPath, "hello")
	}
}

// TestNormalizeStoredPaths_FileCollisionLeavesOneNFCRowWithRangesIntact is D8/D12's second case: a
// stale NFD-keyed review_file row and an already-correct NFC-keyed row for the SAME session exist
// side by side (exactly what a client upgrading across G27 could have on disk) — after the sweep,
// exactly one review_file row remains, keyed under the composed path, and review_range rows for
// that surviving key are intact (UPDATE OR REPLACE's own conflict resolution, normalize.go's doc
// comment).
func TestNormalizeStoredPaths_FileCollisionLeavesOneNFCRowWithRangesIntact(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	decomposedPath := "caf" + normalizeDecomposedE + ".txt"
	composedPath := "caf" + normalizeComposedE + ".txt"

	// The stale NFD row.
	staleRec := FileRecord{
		Path: decomposedPath, State: "partial", ReviewedAtSHA: "sha-stale", ReviewedAt: time.UnixMilli(1000),
		BlobOID: "oid-stale", ContentKind: ContentBinary, Ranges: []LineRange{{Start: 1, End: 2}},
	}
	if err := s.Put(ctx, "repo", "main", staleRec, nil); err != nil {
		t.Fatalf("Put stale: %v", err)
	}
	// The already-correct NFC row for the very same logical file.
	freshRec := FileRecord{
		Path: composedPath, State: "full", ReviewedAtSHA: "sha-fresh", ReviewedAt: time.UnixMilli(5000),
		BlobOID: "oid-fresh", ContentKind: ContentBinary, Ranges: []LineRange{{Start: 10, End: 20}},
	}
	if err := s.Put(ctx, "repo", "main", freshRec, nil); err != nil {
		t.Fatalf("Put fresh: %v", err)
	}

	db, err := s.conn()
	if err != nil {
		t.Fatalf("conn: %v", err)
	}

	var fileCountBefore int
	if err := db.QueryRow(`SELECT COUNT(*) FROM review_file`).Scan(&fileCountBefore); err != nil {
		t.Fatalf("count review_file before: %v", err)
	}
	if fileCountBefore != 2 {
		t.Fatalf("review_file has %d rows before the sweep, want 2 (the two colliding spellings)", fileCountBefore)
	}

	if err := normalizeStoredPaths(db); err != nil {
		t.Fatalf("normalizeStoredPaths: %v", err)
	}

	var fileCountAfter int
	if err := db.QueryRow(`SELECT COUNT(*) FROM review_file`).Scan(&fileCountAfter); err != nil {
		t.Fatalf("count review_file after: %v", err)
	}
	if fileCountAfter != 1 {
		t.Fatalf("review_file has %d rows after the sweep, want exactly 1 (the collision collapsed)", fileCountAfter)
	}

	var survivingPath string
	if err := db.QueryRow(`SELECT path FROM review_file`).Scan(&survivingPath); err != nil {
		t.Fatalf("select surviving review_file: %v", err)
	}
	if survivingPath != composedPath {
		t.Fatalf("surviving review_file.path = %q, want composed %q", survivingPath, composedPath)
	}

	// Every review_range row still standing must belong to the surviving composed path — no
	// dangling range left pointing at a path review_file no longer has a row for (the FK, and this
	// query, would both notice).
	rows, err := db.Query(`SELECT path, start_line, end_line FROM review_range ORDER BY start_line`)
	if err != nil {
		t.Fatalf("query review_range: %v", err)
	}
	defer rows.Close()
	var got [][3]any
	for rows.Next() {
		var path string
		var start, end int
		if err := rows.Scan(&path, &start, &end); err != nil {
			t.Fatalf("scan review_range: %v", err)
		}
		if path != composedPath {
			t.Errorf("review_range row (%q, %d, %d) does not belong to the surviving path %q", path, start, end, composedPath)
		}
		got = append(got, [3]any{path, start, end})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate review_range: %v", err)
	}
	// review_file renamed first (normalize.go's own doc comment on why the order is load-bearing):
	// the stale row's own 1-2 range is what survives, renamed into place. The pre-existing NFC
	// row's own 10-20 range was a child of the row REPLACE deleted to make room, and goes with it
	// — the documented, accepted cost of a genuine collision, not a bug in this test.
	want := [][3]any{{composedPath, 1, 2}}
	if len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("review_range rows for %q = %v, want %v (the stale row's own range, renamed into place)", composedPath, got, want)
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
