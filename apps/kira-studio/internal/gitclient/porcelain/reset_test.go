package porcelain_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func TestLeftRightCountArgs(t *testing.T) {
	t.Parallel()
	got := porcelain.LeftRightCountArgs("abc1234", "HEAD")
	want := []string{"rev-list", "--count", "--left-right", "abc1234...HEAD"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	// Three dots, not two — the one thing this argv must never drift on (D4).
	if got[len(got)-1] != "abc1234...HEAD" {
		t.Fatalf("range token = %q, want three-dot", got[len(got)-1])
	}
}

func TestParseLeftRightCount(t *testing.T) {
	t.Parallel()
	left, right, err := porcelain.ParseLeftRightCount([]byte("3\t5\n"))
	if err != nil {
		t.Fatalf("ParseLeftRightCount: %v", err)
	}
	if left != 3 || right != 5 {
		t.Fatalf("left=%d right=%d, want 3,5", left, right)
	}
}

func TestParseLeftRightCount_Zero(t *testing.T) {
	t.Parallel()
	left, right, err := porcelain.ParseLeftRightCount([]byte("0\t0"))
	if err != nil {
		t.Fatalf("ParseLeftRightCount: %v", err)
	}
	if left != 0 || right != 0 {
		t.Fatalf("left=%d right=%d, want 0,0", left, right)
	}
}

func TestParseLeftRightCount_Garbage(t *testing.T) {
	t.Parallel()
	if _, _, err := porcelain.ParseLeftRightCount([]byte("not a count")); err == nil {
		t.Fatal("want an error over garbage input")
	}
	if _, _, err := porcelain.ParseLeftRightCount([]byte("3")); err == nil {
		t.Fatal("want an error over a single-field line")
	}
	if _, _, err := porcelain.ParseLeftRightCount([]byte("x\ty")); err == nil {
		t.Fatal("want an error over non-numeric fields")
	}
}

func TestRangeSubjectsArgs(t *testing.T) {
	t.Parallel()
	got := porcelain.RangeSubjectsArgs("abc1234", "HEAD", 10)
	want := []string{"log", "--format=%H%x1f%s", "-z", "-11", "abc1234..HEAD"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// rangeSubjectsFixture builds a `log --format=%H%x1f%s -z` byte sequence for n commits — the same
// NUL-record / 0x1f-field shape real git produces, standing in for a captured fixture (D4: `log`,
// never `rev-list`, is the one thing under test here, not git's own byte-for-byte output).
func rangeSubjectsFixture(n int) []byte {
	var out []byte
	for i := 0; i < n; i++ {
		rec := []byte{}
		rec = append(rec, []byte("sha")...)
		rec = append(rec, byte('0'+i))
		rec = append(rec, 0x1f)
		rec = append(rec, []byte("subject ")...)
		rec = append(rec, byte('0'+i))
		rec = append(rec, 0x00)
		out = append(out, rec...)
	}
	return out
}

func TestParseRangeSubjects_AtCap(t *testing.T) {
	t.Parallel()
	raw := rangeSubjectsFixture(10)
	commits, truncated, err := porcelain.ParseRangeSubjects(raw, 10)
	if err != nil {
		t.Fatalf("ParseRangeSubjects: %v", err)
	}
	if len(commits) != 10 {
		t.Fatalf("got %d commits, want 10", len(commits))
	}
	if truncated {
		t.Fatal("truncated = true, want false at exactly cap")
	}
	if commits[0].Sha != "sha0" || commits[0].Subject != "subject 0" {
		t.Fatalf("commits[0] = %+v", commits[0])
	}
}

func TestParseRangeSubjects_OverCap(t *testing.T) {
	t.Parallel()
	raw := rangeSubjectsFixture(11) // cap+1, the read this package always performs
	commits, truncated, err := porcelain.ParseRangeSubjects(raw, 10)
	if err != nil {
		t.Fatalf("ParseRangeSubjects: %v", err)
	}
	if len(commits) != 10 {
		t.Fatalf("got %d commits, want exactly cap (10), the 11th dropped", len(commits))
	}
	if !truncated {
		t.Fatal("truncated = false, want true when more than cap came back")
	}
}

func TestParseRangeSubjects_Empty(t *testing.T) {
	t.Parallel()
	commits, truncated, err := porcelain.ParseRangeSubjects([]byte{}, 10)
	if err != nil {
		t.Fatalf("ParseRangeSubjects: %v", err)
	}
	if len(commits) != 0 || truncated {
		t.Fatalf("commits=%v truncated=%v, want empty/false", commits, truncated)
	}
}
