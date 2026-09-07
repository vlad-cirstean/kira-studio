package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func TestMergeTreeArgs(t *testing.T) {
	got := porcelain.MergeTreeArgs("HEAD", "topic", "")
	want := []string{"merge-tree", "--write-tree", "--messages", "--name-only", "HEAD", "topic"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}

	withBase := porcelain.MergeTreeArgs("HEAD", "c^1", "c")
	wantBase := []string{"merge-tree", "--write-tree", "--messages", "--name-only", "--merge-base=c", "HEAD", "c^1"}
	if len(withBase) != len(wantBase) {
		t.Fatalf("got %v, want %v", withBase, wantBase)
	}
	for i := range wantBase {
		if withBase[i] != wantBase[i] {
			t.Fatalf("got %v, want %v", withBase, wantBase)
		}
	}
}

func TestParseMergeTreeOutput_Clean(t *testing.T) {
	pred, err := porcelain.ParseMergeTreeOutput(readDiffFixture(t, "mergeTree/clean.bin"), 0)
	if err != nil {
		t.Fatalf("ParseMergeTreeOutput: %v", err)
	}
	if pred.Kind != "clean" || pred.TreeID == "" {
		t.Fatalf("pred = %+v", pred)
	}
	if len(pred.Paths) != 0 {
		t.Fatalf("paths = %v, want none on a clean prediction", pred.Paths)
	}
}

func TestParseMergeTreeOutput_Conflicts(t *testing.T) {
	pred, err := porcelain.ParseMergeTreeOutput(readDiffFixture(t, "mergeTree/conflict.bin"), 1)
	if err != nil {
		t.Fatalf("ParseMergeTreeOutput: %v", err)
	}
	if pred.Kind != "conflicts" {
		t.Fatalf("pred = %+v", pred)
	}
	if len(pred.Paths) != 1 || pred.Paths[0] != "f.txt" {
		t.Fatalf("paths = %v, want [f.txt]", pred.Paths)
	}
	if len(pred.Messages) == 0 {
		t.Fatal("want at least one message block (Auto-merging/CONFLICT lines)")
	}
}

func TestParseMergeTreeOutput_RealFailureIsAnError(t *testing.T) {
	if _, err := porcelain.ParseMergeTreeOutput([]byte("fatal: bad revision"), 128); err == nil {
		t.Fatal("expected an error for an exit code outside {0,1} — that is a real failure, D14")
	}
}
