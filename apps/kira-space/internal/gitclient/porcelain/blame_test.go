package porcelain_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
)

func readBlameFixture(t *testing.T, relPath string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", relPath))
	if err != nil {
		t.Fatalf("read fixture %s: %v (run KIRA_GIT_FIXTURES=write to regenerate the golden corpus)", relPath, err)
	}
	return b
}

func TestParseBlameLine_Committed(t *testing.T) {
	t.Parallel()
	raw := readBlameFixture(t, "blame/committed.bin")
	line, err := porcelain.ParseBlameLine(raw)
	if err != nil {
		t.Fatalf("ParseBlameLine: %v", err)
	}
	if line.SHA == "" || line.SHA == porcelain.UncommittedBlameSHA {
		t.Fatalf("SHA = %q, want a real committed sha", line.SHA)
	}
	if line.Author != "Kira Fixture" {
		t.Fatalf("Author = %q, want %q", line.Author, "Kira Fixture")
	}
	if line.Summary != "second commit" {
		t.Fatalf("Summary = %q, want %q", line.Summary, "second commit")
	}
	if line.AuthorTimeSeconds == 0 {
		t.Fatalf("AuthorTimeSeconds = 0, want a real timestamp")
	}
}

func TestParseBlameLine_Boundary(t *testing.T) {
	t.Parallel()
	raw := readBlameFixture(t, "blame/boundary.bin")
	line, err := porcelain.ParseBlameLine(raw)
	if err != nil {
		t.Fatalf("ParseBlameLine: %v", err)
	}
	if line.SHA == "" || line.SHA == porcelain.UncommittedBlameSHA {
		t.Fatalf("SHA = %q, want a real committed sha", line.SHA)
	}
	if line.Summary != "first commit" {
		t.Fatalf("Summary = %q, want %q", line.Summary, "first commit")
	}
}

func TestParseBlameLine_Uncommitted(t *testing.T) {
	t.Parallel()
	raw := readBlameFixture(t, "blame/uncommitted.bin")
	line, err := porcelain.ParseBlameLine(raw)
	if err != nil {
		t.Fatalf("ParseBlameLine: %v", err)
	}
	if line.SHA != porcelain.UncommittedBlameSHA {
		t.Fatalf("SHA = %q, want the all-zero uncommitted sentinel", line.SHA)
	}
}

// TestParseBlameLine_UnknownAttributeIgnored mirrors TestParseWorktreeList_UnknownAttributeIgnored
// (worktree_test.go): a future git version's own new attribute line must not abort parsing or be
// misfiled onto author/author-time/summary. Hand-built bytes, no fixture needed — the shape is
// pinned, not the output of a real spawn.
func TestParseBlameLine_UnknownAttributeIgnored(t *testing.T) {
	t.Parallel()
	raw := []byte(
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\n" +
			"author Kira Fixture\n" +
			"author-mail <fixture@kira.test>\n" +
			"author-time 1609459200\n" +
			"author-tz +0000\n" +
			"committer Kira Fixture\n" +
			"committer-mail <fixture@kira.test>\n" +
			"committer-time 1609459200\n" +
			"committer-tz +0000\n" +
			"summary first commit\n" +
			"some-future-attribute value nobody expects yet\n" +
			"filename f.txt\n" +
			"\tline one\n",
	)
	line, err := porcelain.ParseBlameLine(raw)
	if err != nil {
		t.Fatalf("ParseBlameLine: %v", err)
	}
	if line.SHA != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("SHA = %q", line.SHA)
	}
	if line.Author != "Kira Fixture" || line.Summary != "first commit" || line.AuthorTimeSeconds != 1609459200 {
		t.Fatalf("line = %+v", line)
	}
}

// TestParseBlameLine_EmptyInput: a killed/empty spawn must not panic.
func TestParseBlameLine_EmptyInput(t *testing.T) {
	t.Parallel()
	if _, err := porcelain.ParseBlameLine(nil); err == nil {
		t.Fatalf("ParseBlameLine(nil): want an error, got nil")
	}
}

// TestIsUncommittedBlameSHA is F18's own regression guard: the uncommitted-line sentinel is an
// all-zero string, but its WIDTH depends on this repository's own object format — 40 zeros for
// SHA-1, 64 for SHA-256 (verified against real git --object-format=sha256), never just a longer
// run of the same SHA-1-width value. IsUncommittedBlameSHA must recognise both, and reject
// anything that merely looks close (wrong width, or not all zero).
func TestIsUncommittedBlameSHA(t *testing.T) {
	t.Parallel()
	cases := []struct {
		sha  string
		want bool
	}{
		{porcelain.UncommittedBlameSHA, true},             // 40 zeros (SHA-1).
		{strings.Repeat("0", 64), true},                   // 64 zeros (SHA-256).
		{strings.Repeat("0", 39), false},                  // one short of SHA-1 width.
		{strings.Repeat("0", 41), false},                  // one over SHA-1 width, not 64 either.
		{"0000000000000000000000000000000000000a", false}, // 40 chars, not all zero.
		{"", false},
	}
	for _, c := range cases {
		if got := porcelain.IsUncommittedBlameSHA(c.sha); got != c.want {
			t.Errorf("IsUncommittedBlameSHA(%q) = %v, want %v", c.sha, got, c.want)
		}
	}
}
