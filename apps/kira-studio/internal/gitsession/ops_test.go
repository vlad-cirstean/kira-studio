package gitsession

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// TestOpTable_EveryEntryStatesAnUndoPolicy is D6's own Go stand-in for upstream's TypeScript
// mapped type (UNDO_POLICY: {[K in OpRequest["kind"]]: UndoPolicy}), which fails tsc when a new
// operation kind is added without a corresponding undo policy. Go has no such compiler check, so
// this test is what stands in its place: every opTable entry's Undo.Kind must be one of the two
// legal values, and every notUndoable entry must carry a real, non-empty reason (never a
// placeholder — §7.12's "we never present an undo we cannot honour").
func TestOpTable_EveryEntryStatesAnUndoPolicy(t *testing.T) {
	if len(opTable) != 10 {
		t.Fatalf("opTable has %d entries, want exactly 10 (D5)", len(opTable))
	}
	for kind, spec := range opTable {
		switch spec.Undo.Kind {
		case gitpreflight.Undoable:
			if spec.Undo.Reason != "" {
				t.Errorf("%s: undoable entries carry no reason, got %q", kind, spec.Undo.Reason)
			}
		case gitpreflight.NotUndoable:
			if spec.Undo.Reason == "" {
				t.Errorf("%s: notUndoable entry has an empty reason", kind)
			}
		default:
			t.Errorf("%s: Undo.Kind = %q, not one of the two legal values", kind, spec.Undo.Kind)
		}
		if spec.Prepare == nil {
			t.Errorf("%s: Prepare is nil", kind)
		}
	}
}

// TestOpTable_ServesExactlyTheTenNamedKinds locks D5's own list — a kind absent here answers
// ErrUnservedOpKind, never a stub.
func TestOpTable_ServesExactlyTheTenNamedKinds(t *testing.T) {
	want := []string{
		"checkout", "branchCreate", "branchDelete", "branchRename",
		"tagCreate", "tagDelete", "revert", "opContinue", "opAbort", "opSkip",
	}
	for _, k := range want {
		if _, ok := opTable[k]; !ok {
			t.Errorf("opTable is missing %q", k)
		}
	}
	unserved := []string{
		"tagPush", "tagDeleteRemote", "stashPush", "stashApply", "stashPop",
		"stashDrop", "stashBranch", "reset", "cherryPick",
	}
	for _, k := range unserved {
		if _, ok := opTable[k]; ok {
			t.Errorf("opTable unexpectedly serves %q — G5 must refuse it (D5)", k)
		}
	}
}

// TestOpTable_UndoableKindsAreExactlyBranchAndTagDelete locks the two kinds this phase captures a
// real undo record for.
func TestOpTable_UndoableKindsAreExactlyBranchAndTagDelete(t *testing.T) {
	var undoable []string
	for kind, spec := range opTable {
		if spec.Undo.Kind == gitpreflight.Undoable {
			undoable = append(undoable, kind)
		}
	}
	if len(undoable) != 2 {
		t.Fatalf("undoable kinds = %v, want exactly 2 (branchDelete, tagDelete)", undoable)
	}
	if opTable["branchDelete"].Undo.Kind != gitpreflight.Undoable || opTable["tagDelete"].Undo.Kind != gitpreflight.Undoable {
		t.Fatalf("branchDelete/tagDelete must both be undoable")
	}
}
