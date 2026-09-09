package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// splitStatusRecords frames raw -z stdout into records exactly as gitsession will — status.go's
// own parser takes an already-split []byte slice (the same convention difftree.go's parsers use),
// never raw bytes.
func splitStatusRecords(t *testing.T, raw []byte) [][]byte {
	t.Helper()
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if flushed := splitter.Flush(); flushed != nil {
		t.Fatalf("unterminated trailing bytes: %q", flushed)
	}
	return recs
}

func TestParseStatus_Clean(t *testing.T) {
	result, err := porcelain.ParseStatus(splitStatusRecords(t, readDiffFixture(t, "status/clean.bin")))
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if result.Branch.Unborn || result.Branch.OID == "" {
		t.Fatalf("branch = %+v, want a real oid, not unborn", result.Branch)
	}
	if result.Branch.Detached || result.Branch.HeadName != "main" {
		t.Fatalf("branch = %+v, want head=main", result.Branch)
	}
	if len(result.Entries) != 0 {
		t.Fatalf("entries = %+v, want none", result.Entries)
	}
}

// TestParseStatus_Mixed proves the '1' (ordinary) and '?' (untracked) markers, and that a
// no-upstream repo leaves HasAheadBehind false rather than zero-valued.
func TestParseStatus_Mixed(t *testing.T) {
	result, err := porcelain.ParseStatus(splitStatusRecords(t, readDiffFixture(t, "status/mixed.bin")))
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if result.Branch.HasAheadBehind {
		t.Fatalf("branch = %+v, want HasAheadBehind false (no upstream configured)", result.Branch)
	}
	if len(result.Entries) != 3 {
		t.Fatalf("entries = %+v, want 3", result.Entries)
	}
	var sawModified, sawAdded, sawUntracked bool
	for _, e := range result.Entries {
		switch e.Path {
		case "a.txt":
			sawModified = e.Kind == "ordinary" && e.Staged == '.' && e.Unstaged == 'M'
		case "staged.txt":
			sawAdded = e.Kind == "ordinary" && e.Staged == 'A' && e.Unstaged == '.'
		case "untracked.txt":
			sawUntracked = e.Kind == "untracked"
		}
	}
	if !sawModified || !sawAdded || !sawUntracked {
		t.Fatalf("entries = %+v, missing an expected row", result.Entries)
	}
}

// TestParseStatus_Renamed proves the '2' record's own two-NUL-chunk framing: originalPath is a
// SEPARATE following record, and a following record (were there one) would still parse correctly.
func TestParseStatus_Renamed(t *testing.T) {
	result, err := porcelain.ParseStatus(splitStatusRecords(t, readDiffFixture(t, "status/renamed.bin")))
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if len(result.Entries) != 1 {
		t.Fatalf("entries = %+v, want exactly 1", result.Entries)
	}
	e := result.Entries[0]
	if e.Kind != "renamed" || e.Path != "renamed.txt" || e.OriginalPath != "old.txt" {
		t.Fatalf("entry = %+v", e)
	}
	if e.RenameOrCopy != "rename" {
		t.Fatalf("renameOrCopy = %q, want rename", e.RenameOrCopy)
	}
	if e.Similarity != 100 {
		t.Fatalf("similarity = %d, want 100 (identical content, just moved)", e.Similarity)
	}
	if e.Staged != 'R' {
		t.Fatalf("staged = %q, want R", string(e.Staged))
	}
}

func TestParseStatus_Unmerged(t *testing.T) {
	result, err := porcelain.ParseStatus(splitStatusRecords(t, readDiffFixture(t, "status/unmerged.bin")))
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if len(result.Entries) != 1 {
		t.Fatalf("entries = %+v, want exactly 1", result.Entries)
	}
	e := result.Entries[0]
	if e.Kind != "unmerged" || e.Path != "f.txt" {
		t.Fatalf("entry = %+v", e)
	}
	if e.Staged != 'U' || e.Unstaged != 'U' {
		t.Fatalf("XY = %q%q, want UU", string(e.Staged), string(e.Unstaged))
	}
}

// TestParseStatus_Unborn proves probe P11: "(initial)" is the unborn signal, not an error.
func TestParseStatus_Unborn(t *testing.T) {
	result, err := porcelain.ParseStatus(splitStatusRecords(t, readDiffFixture(t, "status/unborn.bin")))
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if !result.Branch.Unborn || result.Branch.OID != "" {
		t.Fatalf("branch = %+v, want Unborn with an empty OID", result.Branch)
	}
	if result.Branch.HeadName != "main" {
		t.Fatalf("branch.HeadName = %q, want main", result.Branch.HeadName)
	}
	if len(result.Entries) != 0 {
		t.Fatalf("entries = %+v, want none", result.Entries)
	}
}

// TestParseStatus_PathWithSpace proves the space-limited field split absorbs a path's own spaces
// into the final field rather than truncating at the first one.
func TestParseStatus_PathWithSpace(t *testing.T) {
	rec := []byte("1 .M N... 100644 100644 100644 " +
		"78981922613b2afb6025042ff6bd878ac1994e8 78981922613b2afb6025042ff6bd878ac1994e8 a file with spaces.txt")
	result, err := porcelain.ParseStatus([][]byte{rec})
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	if len(result.Entries) != 1 || result.Entries[0].Path != "a file with spaces.txt" {
		t.Fatalf("entries = %+v", result.Entries)
	}
}

func TestParseStatus_UnrecognisedMarker(t *testing.T) {
	if _, err := porcelain.ParseStatus([][]byte{[]byte("x bogus record")}); err == nil {
		t.Fatal("expected an error for an unrecognised status marker")
	}
}

// TestParseStatus_UntrackedPathStaysDecomposed is G27 D2/D12's tier-2 negative: a status record's
// Path is repository-relative (probe P7 — handed straight back to git as a pathspec), so it must
// stay byte-exact even when git's own readdir-sourced bytes are decomposed. This is the test that
// stops a future contributor from "finishing the job" by normalizing this field too (D12).
func TestParseStatus_UntrackedPathStaysDecomposed(t *testing.T) {
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	rec := []byte("? caf" + decomposedE + ".txt")

	result, err := porcelain.ParseStatus([][]byte{rec})
	if err != nil {
		t.Fatalf("ParseStatus: %v", err)
	}
	want := "caf" + decomposedE + ".txt"
	if len(result.Entries) != 1 || result.Entries[0].Path != want {
		t.Fatalf("entries = %+v, want Path %q byte-exact (untouched)", result.Entries, want)
	}
}

func TestParseStatus_RenamedMissingOriginalPathChunk(t *testing.T) {
	rec := []byte("2 R. N... 100644 100644 100644 " +
		"0c2aa38e0600e0d2df09c2f84664d8a14f899879 0c2aa38e0600e0d2df09c2f84664d8a14f899879 R100 renamed.txt")
	if _, err := porcelain.ParseStatus([][]byte{rec}); err == nil {
		t.Fatal("expected an error when a '2' record has no following originalPath chunk")
	}
}
