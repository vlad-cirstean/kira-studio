package repos_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// TestFilterHistoryReRecordMovesNotDuplicates pins the dedupe delete's use of SQLite's NULL-safe
// IS operator: `where_text = NULL` never matches anything, so the obvious `=` form would let an
// entry with a NULL where_text be re-inserted on every use and fill the history with copies of
// itself. Re-recording an identical entry must move it, not duplicate it.
func TestFilterHistoryReRecordMovesNotDuplicates(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")

	// where=nil, orderBy=nil is a no-op per Record's own rule, so exercise the NULL where_text
	// path with an orderBy-only entry re-recorded identically — the IS-operator dedupe's actual
	// target.
	spec := &model.SortSpec{Kind: "text", Text: "x"}
	if err := r.Record("c1", "p", nil, spec); err != nil {
		t.Fatalf("Record 1: %v", err)
	}
	if err := r.Record("c1", "p", nil, spec); err != nil {
		t.Fatalf("Record 2 (identical): %v", err)
	}
	entries, err := r.List("c1", "p", 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("List() after re-recording identical entry = %+v, want exactly 1 (moved, not duplicated)", entries)
	}
}
