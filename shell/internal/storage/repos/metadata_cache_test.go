package repos_test

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestMetadataCachePutGet(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")

	if err := r.Put("c1", "db:t", "children", json.RawMessage(`["a","b"]`)); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := r.Get("c1", "db:t", "children")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(got) != `["a","b"]` {
		t.Errorf("Get() = %s, want [\"a\",\"b\"]", got)
	}
}

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

func TestMetadataCacheGetMissReturnsNil(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")
	got, err := r.Get("c1", "db:missing", "children")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Errorf("Get(miss) = %s, want nil", got)
	}
}

func TestMetadataCacheOversizedPayloadRefused(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")

	if err := r.Put("c1", "db:t", "children", json.RawMessage(`["existing"]`)); err != nil {
		t.Fatalf("Put initial: %v", err)
	}

	huge := make([]byte, 5*1024*1024)
	for i := range huge {
		huge[i] = 'a'
	}
	hugeJSON, err := json.Marshal(string(huge))
	if err != nil {
		t.Fatalf("marshal huge: %v", err)
	}
	if err := r.Put("c1", "db:t", "describe", hugeJSON); err != nil {
		t.Fatalf("Put oversized: %v", err)
	}

	// The existing row must be untouched — describe was refused, children survives.
	children, err := r.Get("c1", "db:t", "children")
	if err != nil {
		t.Fatalf("Get children: %v", err)
	}
	if string(children) != `["existing"]` {
		t.Errorf("Get(children) after refused oversized Put = %s, want unchanged", children)
	}
	describe, err := r.Get("c1", "db:t", "describe")
	if err != nil {
		t.Fatalf("Get describe: %v", err)
	}
	if describe != nil {
		t.Errorf("Get(describe) after refused oversized Put = %s, want nil (never written)", describe)
	}
}

func TestMetadataCacheDrop(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")
	if err := r.Put("c1", "db:t", "children", json.RawMessage(`[]`)); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := r.Drop("c1", "db:t"); err != nil {
		t.Fatalf("Drop: %v", err)
	}
	got, err := r.Get("c1", "db:t", "children")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Errorf("Get() after Drop = %s, want nil", got)
	}
}

func TestMetadataCacheDropConnection(t *testing.T) {
	r := newMetadataCacheRepo(t)
	seedConnection(t, r.DB, "c1")
	if err := r.Put("c1", "db:a", "children", json.RawMessage(`[]`)); err != nil {
		t.Fatalf("Put a: %v", err)
	}
	if err := r.Put("c1", "db:b", "children", json.RawMessage(`[]`)); err != nil {
		t.Fatalf("Put b: %v", err)
	}
	if err := r.DropConnection("c1"); err != nil {
		t.Fatalf("DropConnection: %v", err)
	}
	var count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM metadata_cache WHERE connection_id = 'c1'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("row count after DropConnection = %d, want 0", count)
	}
}

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
