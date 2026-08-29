package repos_test

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestFilterHistoryRecordListRoundTrip(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")

	where := "x = 1"
	if err := r.Record("c1", "p", &where, nil); err != nil {
		t.Fatalf("Record where-only: %v", err)
	}
	spec := &model.SortSpec{Kind: "text", Text: "x asc"}
	if err := r.Record("c1", "p2", nil, spec); err != nil {
		t.Fatalf("Record orderBy-only: %v", err)
	}
	where2 := "y = 2"
	if err := r.Record("c1", "p3", &where2, spec); err != nil {
		t.Fatalf("Record both: %v", err)
	}

	for _, path := range []string{"p", "p2", "p3"} {
		entries, err := r.List("c1", path, 10)
		if err != nil {
			t.Fatalf("List(%s): %v", path, err)
		}
		if len(entries) != 1 {
			t.Errorf("List(%s) = %+v, want exactly 1 entry", path, entries)
		}
	}
}

func TestFilterHistoryBothNilRecordsNothing(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")
	if err := r.Record("c1", "p", nil, nil); err != nil {
		t.Fatalf("Record: %v", err)
	}
	entries, err := r.List("c1", "p", 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("List() = %+v, want empty (both-nil is not history)", entries)
	}
}

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

func TestFilterHistoryCapKeepsNewest(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")
	for i := 0; i < 25; i++ {
		where := time.Duration(i).String() // distinct value per iteration
		if err := r.Record("c1", "p", &where, nil); err != nil {
			t.Fatalf("Record %d: %v", i, err)
		}
	}
	entries, err := r.List("c1", "p", 100)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 20 {
		t.Fatalf("List() len = %d, want 20 (capped)", len(entries))
	}
	lastWhere := time.Duration(24).String()
	if entries[0].Where == nil || *entries[0].Where != lastWhere {
		t.Errorf("newest entry missing after cap: entries[0] = %+v", entries[0])
	}
}

func TestFilterHistoryListLimit(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")
	for i := 0; i < 5; i++ {
		where := time.Duration(i).String()
		if err := r.Record("c1", "p", &where, nil); err != nil {
			t.Fatalf("Record %d: %v", i, err)
		}
	}
	entries, err := r.List("c1", "p", 2)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("List(limit=2) len = %d, want 2", len(entries))
	}
}

func TestFilterHistoryListDropsInvalidOrderByJSON(t *testing.T) {
	r := newFilterHistoryRepo(t)
	seedConnection(t, r.DB, "c1")
	if _, err := r.DB.Exec(
		`INSERT INTO filter_history (id, connection_id, path, where_text, order_by_json, used_at)
		 VALUES ('x', 'c1', 'p', NULL, 'not json', ?)`,
		model.NowISO(),
	); err != nil {
		t.Fatalf("seed: %v", err)
	}
	entries, err := r.List("c1", "p", 10)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("List() = %+v, want empty (invalid order_by_json row should be dropped)", entries)
	}
}
