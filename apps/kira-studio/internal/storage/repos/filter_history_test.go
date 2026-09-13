package repos_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
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

// P23 §4.2 case 3: filter_history's per-path cap (regression — Record had no test at all before
// this phase) still trims to 20 rows on its own path once the per-connection cap (D4) is nowhere
// near being reached.
func TestFilterHistoryPerPathCapStillWorks(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")

	for i := 0; i < 21; i++ {
		w := fmt.Sprintf("where-%d", i)
		if err := r.Record("c1", "p", &w, nil); err != nil {
			t.Fatalf("Record(%d): %v", i, err)
		}
	}

	entries, err := r.List("c1", "p", 100)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 20 {
		t.Fatalf("List() after 21 recordings on one path = %d entries, want 20", len(entries))
	}
}

// P23 §4.2 case 3: past the per-connection cap (D4, 4,000 = metadata_cache's 200 paths/connection
// x filter_history's own 20 rows/path), the least-recently-used path's rows are evicted and the
// most-recently-used path's are not — the property a flat per-path cap alone cannot give. 4,000
// background rows are seeded directly (one bulk transaction, bypassing Record's own three
// statements per call) so the boundary is exercised with a single real Record call rather than
// 4,000 of them, which is both true to what the cap actually bounds and fast.
func TestFilterHistoryPerConnectionCapEvictsLeastRecentlyUsedPath(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")

	tx, err := r.DB.Begin()
	if err != nil {
		t.Fatalf("begin seed tx: %v", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO filter_history (id, connection_id, path, where_text, order_by_json, used_at)
		VALUES (?, 'c1', ?, 'seed', NULL, ?)`)
	if err != nil {
		t.Fatalf("prepare seed insert: %v", err)
	}
	base := time.Now().Add(-24 * time.Hour)
	const total = 4000 // historyPerConnectionLimit, unexported — mirrored here as a literal the
	// same way other repo tests mirror a private cap rather than exporting it.
	for i := 0; i < total; i++ {
		id := fmt.Sprintf("fh-%05d", i)
		path := fmt.Sprintf("p%05d", i) // one row per path: the per-path cap (20) never fires here.
		usedAt := model.FormatISO(base.Add(time.Duration(i) * time.Millisecond))
		if _, err := stmt.Exec(id, path, usedAt); err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
	}
	if err := stmt.Close(); err != nil {
		t.Fatalf("close seed stmt: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit seed tx: %v", err)
	}

	// One real Record call, on a brand-new path — this is what must trigger the per-connection
	// sweep and push the connection from exactly at cap to one over.
	w := "newest"
	if err := r.Record("c1", "new-path", &w, nil); err != nil {
		t.Fatalf("Record: %v", err)
	}

	var count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM filter_history WHERE connection_id = 'c1'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != total {
		t.Fatalf("filter_history row count for c1 = %d, want exactly %d (the per-connection cap)", count, total)
	}

	// p00000 has the oldest used_at of the whole seeded set — the least-recently-used path.
	var lruSurvived int
	err = r.DB.QueryRow(`SELECT 1 FROM filter_history WHERE path = 'p00000'`).Scan(&lruSurvived)
	if err == nil {
		t.Error("the least-recently-used path's row survived the per-connection sweep, want it evicted")
	}

	newest, err := r.List("c1", "new-path", 10)
	if err != nil {
		t.Fatalf("List(new-path): %v", err)
	}
	if len(newest) != 1 {
		t.Fatal("the just-recorded row was itself evicted — the per-entry cap invariant is broken")
	}
}

// P23 §4.2 case 3: a where_text over the per-row cap (4 KiB) is stored truncated, silently.
func TestFilterHistoryWhereTextOverCapIsTruncated(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")

	oversized := strings.Repeat("w", 5000)
	if err := r.Record("c1", "p", &oversized, nil); err != nil {
		t.Fatalf("Record: %v", err)
	}

	entries, err := r.List("c1", "p", 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("List() = %d entries, want 1", len(entries))
	}
	if entries[0].Where == nil || len(*entries[0].Where) != 4*1024 {
		gotLen := -1
		if entries[0].Where != nil {
			gotLen = len(*entries[0].Where)
		}
		t.Fatalf("Where length = %d, want exactly 4 KiB (4096)", gotLen)
	}
	if !strings.HasPrefix(oversized, *entries[0].Where) {
		t.Fatal("stored where_text is not a prefix of the original")
	}
}
