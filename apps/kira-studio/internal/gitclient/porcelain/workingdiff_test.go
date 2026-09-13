package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// TestParseWorkingDiff_Mixed confirms ParseNumstatRecords/ParseNameStatusRecords/CombineFileChanges
// — established against diff-tree output — parse plain `git diff`'s identical `-z` framing without
// any change: a staged add and an unstaged modify against HEAD, both combined into one spawn (P7,
// item 2's own "one diff HEAD covers both" design).
func TestParseWorkingDiff_Mixed(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/mixed.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/mixed.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 2 {
		t.Fatalf("got %d combined rows, want 2 (a.txt modified, staged.txt added)", len(combined))
	}
	byPath := make(map[string]porcelain.FileChange, len(combined))
	for _, fc := range combined {
		byPath[fc.Path] = fc
	}
	if fc, ok := byPath["a.txt"]; !ok || fc.Kind != porcelain.FileModified {
		t.Fatalf("a.txt = %+v, ok=%v, want modified", fc, ok)
	}
	if fc, ok := byPath["staged.txt"]; !ok || fc.Kind != porcelain.FileAdded {
		t.Fatalf("staged.txt = %+v, ok=%v, want added", fc, ok)
	}
}

// TestParseWorkingDiff_UnstagedRename confirms -M still detects a rename that is on disk but never
// staged — the one shape commit.detail's own diff-tree fixtures cannot produce, since a rename
// there is always already staged into a commit.
func TestParseWorkingDiff_UnstagedRename(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/renamed.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/renamed.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 1 {
		t.Fatalf("got %d combined rows, want 1", len(combined))
	}
	fc := combined[0]
	if fc.Kind != porcelain.FileRenamed || fc.Path != "renamed.txt" || !strPtrEq(fc.OriginalPath, "old.txt") {
		t.Fatalf("combined[0] = %+v, want renamed old.txt -> renamed.txt", fc)
	}
}

// TestParseWorkingDiff_UnbornHead confirms EmptyTreeSHA works as the base against a fresh,
// zero-commit repo — gitsession.WorkingDetail's own base-selection branch for statusResult.
// Branch.Unborn.
func TestParseWorkingDiff_UnbornHead(t *testing.T) {
	t.Parallel()
	numstat, err := porcelain.ParseNumstatRecords(readFixtureRecords(t, "workingDiff/unbornHead.numstat.bin"))
	if err != nil {
		t.Fatalf("ParseNumstatRecords: %v", err)
	}
	nameStatus, err := porcelain.ParseNameStatusRecords(readFixtureRecords(t, "workingDiff/unbornHead.nameStatus.bin"))
	if err != nil {
		t.Fatalf("ParseNameStatusRecords: %v", err)
	}
	combined := porcelain.CombineFileChanges(numstat, nameStatus)
	if len(combined) != 1 || combined[0].Kind != porcelain.FileAdded || combined[0].Path != "staged.txt" {
		t.Fatalf("combined = %+v, want one added staged.txt", combined)
	}
}
