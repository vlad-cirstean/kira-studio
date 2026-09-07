package gitpreflight

import "sync"

// UndoRecord is one captured undo — a port of undo/slot.ts's own UndoRecord, plus D7's two
// attribution fields. OriginConn/OriginLabel never cross the wire directly (UndoSlotSnapshot has
// no such field) — SnapshotFor composes the attribution as a read-time suffix instead (D7).
// OriginConn is a plain string rather than gitsession.ConnID: this package imports gitclient/
// porcelain and stdlib only (D3), never gitsession.
type UndoRecord struct {
	ID string
	// Label is upstream's exact text ("Deleted branch <name>" / "Deleted tag <name>") — F9: the
	// webview pattern-matches on it, so it must stay byte-identical to upstream's.
	Label       string
	RecoverySha string
	CreatedAt   int64 // unix millis.
	// Replay is the argv sequence that undoes it, applied in order — a list because restoring a
	// branch is a ref write plus zero or more config writes (probe P4).
	Replay      [][]string
	OriginConn  string
	OriginLabel string
}

// UndoSlotSnapshot mirrors @kira/git-ipc's own UndoSlotSnapshot field for field.
type UndoSlotSnapshot struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	RecoverySha string `json:"recoverySha"`
	CreatedAt   int64  `json:"createdAt"`
}

// SnapshotFor composes SPEC §6's undo attribution as a read-time SUFFIX, appended only when conn
// is not the record's own originator (D7/F9): this keeps the single-window label byte-identical to
// upstream's — two future phases (G12/G13) pattern-match on it, both start-anchored — while still
// satisfying "so a second window sees 'Undo reset of main (window: repo-review)'". A record with
// no origin label (a raw socket client that sent none) gets no suffix rather than "(window: )".
func (r *UndoRecord) SnapshotFor(conn string) UndoSlotSnapshot {
	label := r.Label
	if conn != r.OriginConn && r.OriginLabel != "" {
		label += " (window: " + r.OriginLabel + ")"
	}
	return UndoSlotSnapshot{ID: r.ID, Label: label, RecoverySha: r.RecoverySha, CreatedAt: r.CreatedAt}
}

// UndoPolicyKind is UndoPolicy's own discriminant.
type UndoPolicyKind string

const (
	Undoable    UndoPolicyKind = "undoable"
	NotUndoable UndoPolicyKind = "notUndoable"
)

// UndoPolicy mirrors undo/slot.ts's own UndoPolicy — Reason is meaningful only for NotUndoable,
// and is always real user-facing text (never a placeholder, §7.12).
type UndoPolicy struct {
	Kind   UndoPolicyKind
	Reason string
}

// UndoSlot is one repo's undo slot (SPEC §6: "one per repo, not per connection") — a direct port
// of undo/slot.ts's own UndoSlot, with its own mutex per gitsession's cache pattern (D7). Its three
// lifecycle bounds are gitsession's own: the next op on the repo clears it (Set, called
// unconditionally by RunOp — clearing is the default, retaining the explicit act), the entry's
// teardown drops it (it simply goes out of scope with the RepoEntry), and undo.run refuses a
// recovery sha that no longer resolves (gitsession.UndoRun, after Take).
type UndoSlot struct {
	mu     sync.Mutex
	record *UndoRecord
}

// Peek returns the current record without mutating the slot.
func (s *UndoSlot) Peek() *UndoRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.record
}

// Set replaces the slot's record — nil clears it. Called for EVERY op (§7.12).
func (s *UndoSlot) Set(r *UndoRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.record = r
}

// Take returns the record and clears the slot, so a replayed undo cannot be replayed twice. nil
// when there is no record, or id does not match the one currently held (stale UI, a second op
// already cleared it).
func (s *UndoSlot) Take(id string) *UndoRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.record == nil || s.record.ID != id {
		return nil
	}
	r := s.record
	s.record = nil
	return r
}
