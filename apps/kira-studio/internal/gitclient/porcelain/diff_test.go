package porcelain_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func readDiffFixture(t *testing.T, relPath string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", relPath))
	if err != nil {
		t.Fatalf("read fixture %s: %v (run KIRA_GIT_FIXTURES=write to regenerate the golden corpus)", relPath, err)
	}
	return b
}

func TestParseFileDiffBody_Text(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/text.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedText {
		t.Fatalf("kind = %q, want text", body.Kind)
	}
	if len(body.Hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(body.Hunks))
	}
	hunk := body.Hunks[0]
	if hunk.OldStart != 1 || hunk.OldLines != 3 || hunk.NewStart != 1 || hunk.NewLines != 3 {
		t.Fatalf("hunk = %+v, want @@ -1,3 +1,3 @@", hunk)
	}
	if len(hunk.Lines) != 4 {
		t.Fatalf("got %d lines, want 4 (context, del, add, context)", len(hunk.Lines))
	}
	wantKinds := []porcelain.DiffLineKind{porcelain.LineContext, porcelain.LineDel, porcelain.LineAdd, porcelain.LineContext}
	for i, k := range wantKinds {
		if hunk.Lines[i].Kind != k {
			t.Fatalf("line %d kind = %q, want %q", i, hunk.Lines[i].Kind, k)
		}
	}
	del := hunk.Lines[1]
	if del.Text != "line2" || del.OldLine == nil || *del.OldLine != 2 || del.NewLine != nil {
		t.Fatalf("del line = %+v", del)
	}
	add := hunk.Lines[2]
	if add.Text != "line2 CHANGED" || add.NewLine == nil || *add.NewLine != 2 || add.OldLine != nil {
		t.Fatalf("add line = %+v", add)
	}
}

// TestParseFileDiffBody_Rename proves probe P2's own consequence held: FileDiffArgs names both
// paths in its pathspec, so the patch renders as a rename (similarity/rename headers, a real
// hunk), never a whole-file add.
func TestParseFileDiffBody_Rename(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/rename.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedText {
		t.Fatalf("kind = %q, want text (a rename with an edit still has a hunk)", body.Kind)
	}
	if len(body.Hunks) != 1 || body.Hunks[0].OldStart != 2 {
		t.Fatalf("hunks = %+v, want one hunk starting at old line 2", body.Hunks)
	}
}

func TestParseFileDiffBody_AddedFile(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/addedFile.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedText {
		t.Fatalf("kind = %q, want text", body.Kind)
	}
	if len(body.Hunks) != 1 || body.Hunks[0].OldLines != 0 {
		t.Fatalf("hunks = %+v, want one hunk with oldLines=0 (@@ -0,0 +1 @@)", body.Hunks)
	}
	if len(body.Hunks[0].Lines) != 1 || body.Hunks[0].Lines[0].Kind != porcelain.LineAdd {
		t.Fatalf("lines = %+v, want a single add line", body.Hunks[0].Lines)
	}
}

func TestParseFileDiffBody_DeletedFile(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/deletedFile.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedText {
		t.Fatalf("kind = %q, want text", body.Kind)
	}
	if len(body.Hunks) != 1 || body.Hunks[0].NewLines != 0 {
		t.Fatalf("hunks = %+v, want one hunk with newLines=0", body.Hunks)
	}
}

func TestParseFileDiffBody_Binary(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/binary.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedBinary {
		t.Fatalf("kind = %q, want binary", body.Kind)
	}
	if body.OldOID == "" || body.NewOID == "" {
		t.Fatalf("body = %+v, want both oids set from the index line", body)
	}
}

func TestParseFileDiffBody_ModeOnly(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/modeOnly.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedEmpty || body.EmptyReason != "modeChangeOnly" {
		t.Fatalf("body = %+v, want empty/modeChangeOnly", body)
	}
}

// TestParseFileDiffBody_PureRenameIsIdentical proves the "empty" arm's other reason: a rename
// with no content edit at all produces no index line and no hunks, and is "identical" — not
// "modeChangeOnly", which is reserved for old/new mode lines specifically.
func TestParseFileDiffBody_PureRenameIsIdentical(t *testing.T) {
	raw := []byte("diff --git a/a.txt b/b.txt\nsimilarity index 100%\nrename from a.txt\nrename to b.txt\n")
	body, err := porcelain.ParseFileDiffBody(raw)
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedEmpty || body.EmptyReason != "identical" {
		t.Fatalf("body = %+v, want empty/identical", body)
	}
}

func TestParseFileDiffBody_NoNewlineAtEof(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/noNewline.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedText || len(body.Hunks) != 1 {
		t.Fatalf("body = %+v, want one text hunk", body)
	}
	lines := body.Hunks[0].Lines
	if len(lines) != 2 {
		t.Fatalf("got %d lines, want 2 (del, add)", len(lines))
	}
	for i, line := range lines {
		if !line.NoNewlineAtEof {
			t.Fatalf("line %d (%+v): want NoNewlineAtEof=true on both sides", i, line)
		}
	}
}

// TestParseFileDiffBody_LFSPointer proves the LFS sniff: a single-hunk, pure-addition new file
// whose reconstructed content matches the pointer spec is classified lfsPointer, not text.
func TestParseFileDiffBody_LFSPointer(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(readDiffFixture(t, "diff/lfsPointer.bin"))
	if err != nil {
		t.Fatalf("ParseFileDiffBody: %v", err)
	}
	if body.Kind != porcelain.ParsedLFSPointer {
		t.Fatalf("kind = %q, want lfsPointer", body.Kind)
	}
	if body.LFSOID != "sha256:5e44102a3521f3fea5053f4837c91589afba392a633f4c5e6ae825dc5609f706" {
		t.Fatalf("oid = %q", body.LFSOID)
	}
	if body.LFSBytes != 12345 {
		t.Fatalf("bytes = %d, want 12345", body.LFSBytes)
	}
}

// TestParseFileDiffBody_HunkCountsDisagree proves the counts invariant: a hunk whose header
// promises more lines than the body actually supplies before EOF must fail loudly, never
// half-render (AGENTS.md's "no skipped validation").
func TestParseFileDiffBody_HunkCountsDisagree(t *testing.T) {
	raw := []byte("diff --git a/f.txt b/f.txt\nindex 111..222 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n")
	if _, err := porcelain.ParseFileDiffBody(raw); err == nil {
		t.Fatal("expected an error for a hunk whose counts disagree with its content")
	}
}

func TestParseFileDiffBody_Empty(t *testing.T) {
	body, err := porcelain.ParseFileDiffBody(nil)
	if err != nil {
		t.Fatalf("ParseFileDiffBody(nil): %v", err)
	}
	if body.Kind != porcelain.ParsedEmpty || body.EmptyReason != "identical" {
		t.Fatalf("body = %+v, want empty/identical", body)
	}
}

func TestHasDeletedPostImage(t *testing.T) {
	if !porcelain.HasDeletedPostImage(readDiffFixture(t, "diff/deletedFile.bin")) {
		t.Fatal("want true for a real deleted-file diff")
	}
	if porcelain.HasDeletedPostImage(readDiffFixture(t, "diff/text.bin")) {
		t.Fatal("want false for an ordinary text modification")
	}
	if porcelain.HasDeletedPostImage(nil) {
		t.Fatal("want false for empty input (never-tracked path, probe P6)")
	}
}
