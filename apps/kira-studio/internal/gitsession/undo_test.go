package gitsession

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// D18: the undo slot's own lifecycle — set/peek/take, take twice, id mismatch, and cleared by the
// next op (Set(nil) is unconditional, whoever calls it).

func TestUndoSlot_PeekEmpty(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	if got := slot.Peek(); got != nil {
		t.Fatalf("got %+v, want nil", got)
	}
}

func TestUndoSlot_SetThenPeek(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	record := &gitpreflight.UndoRecord{ID: "u1", Label: "Deleted branch feature"}
	slot.Set(record)
	if got := slot.Peek(); got != record {
		t.Fatalf("got %+v, want the same record", got)
	}
	// Peek must never mutate.
	if got := slot.Peek(); got != record {
		t.Fatalf("second peek = %+v, want unchanged", got)
	}
}

func TestUndoSlot_TakeReturnsAndClears(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	record := &gitpreflight.UndoRecord{ID: "u1"}
	slot.Set(record)

	got := slot.Take("u1")
	if got != record {
		t.Fatalf("got %+v, want the record", got)
	}
	if slot.Peek() != nil {
		t.Fatal("slot should be empty after Take")
	}
}

func TestUndoSlot_TakeTwiceReturnsNilSecondTime(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	slot.Set(&gitpreflight.UndoRecord{ID: "u1"})

	first := slot.Take("u1")
	if first == nil {
		t.Fatal("first take should return the record")
	}
	second := slot.Take("u1")
	if second != nil {
		t.Fatalf("second take = %+v, want nil (already taken)", second)
	}
}

func TestUndoSlot_TakeIDMismatch(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	record := &gitpreflight.UndoRecord{ID: "u1"}
	slot.Set(record)

	if got := slot.Take("wrong-id"); got != nil {
		t.Fatalf("got %+v, want nil for a mismatched id", got)
	}
	// The slot must be untouched by a failed Take.
	if slot.Peek() != record {
		t.Fatal("a mismatched Take must not clear the slot")
	}
}

// TestUndoSlot_ClearedByTheNextOp proves §7.12's "performing another operation clears the undo
// slot" at the mechanism level: Set(nil) is unconditional, regardless of who calls it or what was
// there before.
func TestUndoSlot_ClearedByTheNextOp(t *testing.T) {
	t.Parallel()
	var slot gitpreflight.UndoSlot
	slot.Set(&gitpreflight.UndoRecord{ID: "u1", Label: "Deleted branch old"})
	slot.Set(nil) // the "next op" clearing it, whether or not it was itself undoable.
	if got := slot.Peek(); got != nil {
		t.Fatalf("got %+v, want nil after the next op clears it", got)
	}
}

// TestUndoRecord_SnapshotFor_Attribution proves D7/F9's own contract: the label is byte-identical
// for the originating connection, and gains a SUFFIX (never a prefix) for any other reader.
func TestUndoRecord_SnapshotFor_Attribution(t *testing.T) {
	t.Parallel()
	record := &gitpreflight.UndoRecord{
		ID: "u1", Label: "Deleted branch feature", RecoverySha: "abc123",
		OriginConn: "conn-a", OriginLabel: "repo-review",
	}

	own := record.SnapshotFor("conn-a")
	if own.Label != "Deleted branch feature" {
		t.Fatalf("own-window label = %q, want byte-identical to upstream's (no suffix)", own.Label)
	}

	other := record.SnapshotFor("conn-b")
	if other.Label != "Deleted branch feature (window: repo-review)" {
		t.Fatalf("other-window label = %q", other.Label)
	}
}

// TestUndoRecord_SnapshotFor_NoOriginLabel proves a record with no origin label (a raw socket
// client that sent none) gets no suffix at all — never "(window: )".
func TestUndoRecord_SnapshotFor_NoOriginLabel(t *testing.T) {
	t.Parallel()
	record := &gitpreflight.UndoRecord{ID: "u1", Label: "Deleted tag v1", OriginConn: "conn-a"}
	other := record.SnapshotFor("conn-b")
	if other.Label != "Deleted tag v1" {
		t.Fatalf("label = %q, want no suffix", other.Label)
	}
}
