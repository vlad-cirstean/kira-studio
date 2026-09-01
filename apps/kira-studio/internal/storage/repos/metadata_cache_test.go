package repos_test

import (
	"encoding/json"
	"fmt"
	"testing"
)

// TestMetadataCacheDifferentKindsShareOneRow pins Put's merge semantics: the unique index is
// (connection_id, path) and `kind` is a key INSIDE the stored payload object, so caching a
// 'describe' for a path must merge into that path's existing row rather than overwrite the
// 'children' already there. A plain upsert silently destroys the other kind.
func TestMetadataCacheDifferentKindsShareOneRow(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")

	if err := r.Put("c1", "db:t", "children", json.RawMessage(`["a"]`)); err != nil {
		t.Fatalf("Put children: %v", err)
	}
	if err := r.Put("c1", "db:t", "describe", json.RawMessage(`{"cols":1}`)); err != nil {
		t.Fatalf("Put describe: %v", err)
	}

	children, err := r.Get("c1", "db:t", "children")
	if err != nil {
		t.Fatalf("Get children: %v", err)
	}
	describe, err := r.Get("c1", "db:t", "describe")
	if err != nil {
		t.Fatalf("Get describe: %v", err)
	}
	if string(children) != `["a"]` || string(describe) != `{"cols":1}` {
		t.Errorf("children=%s describe=%s, want both readable from the same row", children, describe)
	}

	var rowCount int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM metadata_cache WHERE connection_id = 'c1' AND path = 'db:t'`).Scan(&rowCount); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("row count for one path with two kinds = %d, want 1", rowCount)
	}
}

// TestMetadataCacheEvictionKeepsNewestAndIsolatesConnections covers the per-connection eviction
// pass: the 200-row cap is partitioned BY connection (one busy connection must not evict
// another's rows) and the rows kept are the newest by (fetched_at, rowid).
func TestMetadataCacheEvictionKeepsNewestAndIsolatesConnections(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")
	seedConnection(t, r.DB, "c2")

	if err := r.Put("c2", "db:other", "children", json.RawMessage(`["untouched"]`)); err != nil {
		t.Fatalf("Put c2: %v", err)
	}

	for i := 0; i < 205; i++ {
		path := fmt.Sprintf("db:t%d", i)
		if err := r.Put("c1", path, "children", json.RawMessage(`[]`)); err != nil {
			t.Fatalf("Put c1 %d: %v", i, err)
		}
	}

	var c1Count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM metadata_cache WHERE connection_id = 'c1'`).Scan(&c1Count); err != nil {
		t.Fatalf("count c1: %v", err)
	}
	if c1Count != 200 {
		t.Errorf("c1 row count after 205 puts = %d, want 200 (evicted to cap)", c1Count)
	}

	newest, err := r.Get("c1", "db:t204", "children")
	if err != nil {
		t.Fatalf("Get newest: %v", err)
	}
	if newest == nil {
		t.Error("newest path (db:t204) was evicted, want it to survive")
	}

	untouched, err := r.Get("c2", "db:other", "children")
	if err != nil {
		t.Fatalf("Get c2: %v", err)
	}
	if string(untouched) != `["untouched"]` {
		t.Errorf("c2's row was affected by c1's eviction: %s", untouched)
	}
}
