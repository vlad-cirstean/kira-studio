package enginecache

import "testing"

// Ported 1:1 from tests/unit/engine-cache.spec.ts's "ByteLru" describe block.

func TestByteLru_EvictsOldestOnceBudgetExceeded(t *testing.T) {
	lru := NewByteLru[string](100, nil)
	meta := EntryMeta{ConnectionID: "c", Path: "p"}
	lru.Set("a", "a", 40, meta)
	lru.Set("b", "b", 40, meta)
	lru.Set("c", "c", 40, meta) // 120 > 100 — evicts 'a' (oldest)
	if lru.Bytes() > 100 {
		t.Errorf("bytes = %d, want <= 100", lru.Bytes())
	}
	if _, ok := lru.Get("a"); ok {
		t.Error("'a' should have been evicted")
	}
	if v, ok := lru.Get("b"); !ok || v != "b" {
		t.Errorf("'b' = %q, %v, want \"b\", true", v, ok)
	}
	if v, ok := lru.Get("c"); !ok || v != "c" {
		t.Errorf("'c' = %q, %v, want \"c\", true", v, ok)
	}
}

func TestByteLru_GetTouchesEntry(t *testing.T) {
	lru := NewByteLru[string](100, nil)
	meta := EntryMeta{ConnectionID: "c", Path: "p"}
	lru.Set("a", "a", 40, meta)
	lru.Set("b", "b", 40, meta)
	lru.Get("a")                // touch — 'a' is now newer than 'b'
	lru.Set("c", "c", 40, meta) // 120 > 100 — evicts the now-oldest, 'b', not 'a'
	if v, ok := lru.Get("a"); !ok || v != "a" {
		t.Errorf("'a' = %q, %v, want \"a\", true", v, ok)
	}
	if _, ok := lru.Get("b"); ok {
		t.Error("'b' should have been evicted, not 'a'")
	}
}

func TestByteLru_RefusesEntryOverHalfBudget(t *testing.T) {
	var warned string
	lru := NewByteLru[string](100, func(msg string) { warned = msg })
	meta := EntryMeta{ConnectionID: "c", Path: "p", Label: "huge"}
	lru.Set("huge", "huge", 51, meta) // > 100/2
	if _, ok := lru.Get("huge"); ok {
		t.Error("an entry over half the budget must not be stored")
	}
	if lru.Bytes() != 0 || lru.Size() != 0 {
		t.Errorf("bytes=%d size=%d, want 0, 0", lru.Bytes(), lru.Size())
	}
	if warned == "" {
		t.Error("expected a warning for the refused entry")
	}
}

func TestByteLru_DeleteWhere(t *testing.T) {
	lru := NewByteLru[string](1000, nil)
	lru.Set("a", "a", 10, EntryMeta{ConnectionID: "conn1", Path: "p1"})
	lru.Set("b", "b", 10, EntryMeta{ConnectionID: "conn2", Path: "p2"})
	removed := lru.DeleteWhere(func(m EntryMeta) bool { return m.ConnectionID == "conn1" })
	if removed != 1 {
		t.Errorf("removed = %d, want 1", removed)
	}
	if lru.Size() != 1 || lru.Bytes() != 10 {
		t.Errorf("size=%d bytes=%d, want 1, 10", lru.Size(), lru.Bytes())
	}
	if _, ok := lru.Get("a"); ok {
		t.Error("'a' should have been removed")
	}
	if v, ok := lru.Get("b"); !ok || v != "b" {
		t.Errorf("'b' = %q, %v, want \"b\", true", v, ok)
	}
}

func TestByteLru_SetBudgetShrinksImmediately(t *testing.T) {
	lru := NewByteLru[string](1000, nil)
	meta := EntryMeta{ConnectionID: "c", Path: "p"}
	lru.Set("a", "a", 400, meta)
	lru.Set("b", "b", 400, meta)
	lru.SetBudget(500) // 800 > 500 — evicts 'a' (oldest) until under budget
	if lru.Bytes() > 500 {
		t.Errorf("bytes = %d, want <= 500", lru.Bytes())
	}
	if _, ok := lru.Get("a"); ok {
		t.Error("'a' should have been evicted")
	}
	if v, ok := lru.Get("b"); !ok || v != "b" {
		t.Errorf("'b' = %q, %v, want \"b\", true", v, ok)
	}
}
