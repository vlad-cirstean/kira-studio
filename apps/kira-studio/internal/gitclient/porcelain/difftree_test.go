package porcelain_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func readFixtureRecords(t *testing.T, relPath string) [][]byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", relPath))
	if err != nil {
		t.Fatalf("read fixture %s: %v (run KIRA_GIT_FIXTURES=write to regenerate the golden corpus)", relPath, err)
	}
	splitter := porcelain.NewRecordSplitter(0)
	recs, err := splitter.Push(b)
	if err != nil {
		t.Fatalf("split %s: %v", relPath, err)
	}
	if flushed := splitter.Flush(); flushed != nil {
		t.Fatalf("%s: unterminated trailing bytes: %q", relPath, flushed)
	}
	return recs
}

func strPtrEq(p *string, want string) bool { return p != nil && *p == want }

// TestParseNumstatRecords_RenameWithEdit proves probe P1's own framing: a rename's own record set
// is [counts+empty-path, originalPath, path], and the counts are the true +1 -1 of the edit alone
// — never the +10 -10 a -M-less numstat would report against the whole file.
func TestParseNumstatRecords_RenameWithEdit(t *testing.T) {
	entries, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "diffTree/renameWithEdit.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	e := entries[0]
	if e.Path != "new.txt" || e.OriginalPath != "old.txt" {
		t.Fatalf("entry = %+v, want path=new.txt originalPath=old.txt", e)
	}
	if e.Additions != 1 || e.Deletions != 1 {
		t.Fatalf("entry = %+v, want +1 -1 (not +10 -10)", e)
	}
	if e.IsBinary {
		t.Fatalf("entry = %+v, want isBinary=false", e)
	}
}

func TestParseNameStatusRecords_RenameWithEdit(t *testing.T) {
	entries, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "diffTree/renameWithEdit.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	e := entries[0]
	if e.Kind != porcelain.FileRenamed || e.Path != "new.txt" || e.OriginalPath != "old.txt" {
		t.Fatalf("entry = %+v, want renamed old.txt -> new.txt", e)
	}
	if e.Similarity != 85 {
		t.Fatalf("similarity = %d, want 85", e.Similarity)
	}
}

// TestParseRecords_Mixed covers every letter one commit can plausibly carry at once: add, modify,
// delete, a binary file's own "-\t-\t" numstat framing, and a copy (C) whose source was also
// modified in the same commit — the only way -C finds a copy without --find-copies-harder, which
// FileDiffArgs/NumstatArgs/NameStatusArgs never pass.
func TestParseRecords_Mixed(t *testing.T) {
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "diffTree/mixed.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "diffTree/mixed.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}

	byPath := make(map[string]porcelain.NumstatEntry, len(numstat))
	for _, e := range numstat {
		byPath[e.Path] = e
	}
	if bin, ok := byPath["bin.dat"]; !ok || !bin.IsBinary {
		t.Fatalf("bin.dat numstat = %+v, ok=%v, want a binary '-\\t-\\t' entry", bin, ok)
	}
	if added, ok := byPath["added.txt"]; !ok || added.Additions != 1 || added.Deletions != 0 {
		t.Fatalf("added.txt numstat = %+v, ok=%v, want +1 -0", added, ok)
	}
	if del, ok := byPath["deleted.txt"]; !ok || del.Additions != 0 || del.Deletions != 1 {
		t.Fatalf("deleted.txt numstat = %+v, ok=%v, want +0 -1", del, ok)
	}
	if cp, ok := byPath["copyDst.txt"]; !ok || cp.OriginalPath != "copySrc.txt" {
		t.Fatalf("copyDst.txt numstat = %+v, ok=%v, want originalPath=copySrc.txt", cp, ok)
	}

	kinds := make(map[string]porcelain.FileChangeKind, len(nameStatus))
	sims := make(map[string]int, len(nameStatus))
	for _, e := range nameStatus {
		kinds[e.Path] = e.Kind
		sims[e.Path] = e.Similarity
	}
	want := map[string]porcelain.FileChangeKind{
		"added.txt":      porcelain.FileAdded,
		"bin.dat":        porcelain.FileModified,
		"copyDst.txt":    porcelain.FileCopied,
		"copySrc.txt":    porcelain.FileModified,
		"deleted.txt":    porcelain.FileDeleted,
		"modified.txt":   porcelain.FileModified,
		"typechange.txt": porcelain.FileTypeChanged,
	}
	for path, kind := range want {
		if kinds[path] != kind {
			t.Fatalf("kind[%s] = %q, want %q", path, kinds[path], kind)
		}
	}
	if sims["copyDst.txt"] != 100 {
		t.Fatalf("copyDst.txt similarity = %d, want 100", sims["copyDst.txt"])
	}

	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != len(nameStatus) {
		t.Fatalf("combined has %d rows, want %d (--name-status order, D17)", len(combined), len(nameStatus))
	}
	for i, fc := range combined {
		if fc.Path != nameStatus[i].Path {
			t.Fatalf("combined[%d].Path = %q, want %q (must preserve --name-status order)", i, fc.Path, nameStatus[i].Path)
		}
	}
	var copyRow *porcelain.FileChange
	for i := range combined {
		if combined[i].Path == "copyDst.txt" {
			copyRow = &combined[i]
		}
	}
	if copyRow == nil {
		t.Fatal("no combined row for copyDst.txt")
	}
	if copyRow.Kind != porcelain.FileCopied || !strPtrEq(copyRow.OriginalPath, "copySrc.txt") {
		t.Fatalf("copyDst.txt combined = %+v, want copied from copySrc.txt", copyRow)
	}
	if copyRow.Similarity == nil || *copyRow.Similarity != 100 {
		t.Fatalf("copyDst.txt similarity = %v, want 100", copyRow.Similarity)
	}
	if copyRow.Additions == nil || copyRow.Deletions == nil {
		t.Fatalf("copyDst.txt combined = %+v, want additions/deletions set (not binary)", copyRow)
	}
}

// TestParseNumstatRecords_TruncatedRename proves an empty-path record with fewer than two
// following records is an error, not a panic.
func TestParseNumstatRecords_TruncatedRename(t *testing.T) {
	records := [][]byte{[]byte("1\t1\t"), []byte("old.txt")} // missing the final "new.txt" record
	if _, err := porcelain.ParseNumstatRecords(records); err == nil {
		t.Fatal("expected an error for a record set ending mid-rename")
	}
}

func TestParseNameStatusRecords_UnknownLetter(t *testing.T) {
	records := [][]byte{[]byte("Z"), []byte("some.txt")}
	if _, err := porcelain.ParseNameStatusRecords(records); err == nil {
		t.Fatal("expected an error for an unrecognised name-status letter")
	}
}

// TestParseNumstatRecords_PathStaysDecomposed and TestParseNameStatusRecords_PathStaysDecomposed
// are G27 D2/D12's tier-2 negatives for diff-tree: Path/OriginalPath are repository-relative
// (probe P7 — handed straight back to git as a <rev>:<path> operand or a pathspec), so they must
// stay byte-exact even when git's own tree-sourced bytes are decomposed.
func TestParseNumstatRecords_PathStaysDecomposed(t *testing.T) {
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	records := [][]byte{[]byte("1\t1\t" + "caf" + decomposedE + ".txt")}

	entries, err := porcelain.ParseNumstatRecords(records)
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	want := "caf" + decomposedE + ".txt"
	if len(entries) != 1 || entries[0].Path != want {
		t.Fatalf("entries = %+v, want Path %q byte-exact (untouched)", entries, want)
	}
}

func TestParseNameStatusRecords_PathStaysDecomposed(t *testing.T) {
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	records := [][]byte{[]byte("M"), []byte("caf" + decomposedE + ".txt")}

	entries, err := porcelain.ParseNameStatusRecords(records)
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	want := "caf" + decomposedE + ".txt"
	if len(entries) != 1 || entries[0].Path != want {
		t.Fatalf("entries = %+v, want Path %q byte-exact (untouched)", entries, want)
	}
}
