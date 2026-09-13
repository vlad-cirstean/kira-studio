package repomap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// openFixture writes content to a fresh file under t.TempDir() and returns it open for reading —
// every readRows case in this file shares this one setup.
func openFixture(t *testing.T, content []byte) *os.File {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	t.Cleanup(func() { _ = f.Close() })
	return f
}

func TestReadRowsMultipleOutOfOrder(t *testing.T) {
	f := openFixture(t, []byte("line0\nline1\nline2\nline3\n"))
	got := readRows(f, []int{3, 0, 2})

	want := map[int]string{0: "line0", 2: "line2", 3: "line3"}
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(got), len(want), got)
	}
	for row, text := range want {
		ln, ok := got[row]
		if !ok {
			t.Fatalf("row %d missing from result", row)
		}
		if ln.Text != text || ln.Note != "" {
			t.Errorf("row %d = %+v, want Text %q", row, ln, text)
		}
	}
}

func TestReadRowsOverLongLineThenWantedRow(t *testing.T) {
	// bufio.Scanner would abort the whole scan with ErrTooLong on the long line and silently lose
	// row 1 too — the exact regression readRows/ReadSlice exists to avoid (C8 plan D1/§4.3).
	long := strings.Repeat("x", sourceLineMaxBytes*4)
	f := openFixture(t, []byte(long+"\nwanted\n"))
	got := readRows(f, []int{0, 1})

	ln0, ok := got[0]
	if !ok {
		t.Fatal("row 0 missing")
	}
	if !ln0.Truncated {
		t.Error("row 0: want Truncated true")
	}
	if len(ln0.Text) > sourceLineMaxBytes {
		t.Errorf("row 0: Text is %d bytes, want <= %d", len(ln0.Text), sourceLineMaxBytes)
	}

	ln1, ok := got[1]
	if !ok {
		t.Fatal("row 1 missing — lost behind the over-long row 0")
	}
	if ln1.Text != "wanted" || ln1.Truncated {
		t.Errorf("row 1 = %+v, want Text \"wanted\", Truncated false", ln1)
	}
}

func TestReadRowsRuneBoundaryTruncation(t *testing.T) {
	// Pad so the cut point lands inside a multi-byte rune (3-byte "€", U+20AC) straddling byte
	// sourceLineMaxBytes.
	pad := strings.Repeat("a", sourceLineMaxBytes-1)
	line := pad + "€€€€"
	f := openFixture(t, []byte(line+"\n"))
	got := readRows(f, []int{0})

	ln, ok := got[0]
	if !ok {
		t.Fatal("row 0 missing")
	}
	if !ln.Truncated {
		t.Error("want Truncated true")
	}
	if !utf8.ValidString(ln.Text) {
		t.Fatalf("Text is not valid UTF-8: %q", ln.Text)
	}
	if strings.ContainsRune(ln.Text, utf8.RuneError) {
		t.Errorf("Text contains a half rune: %q", ln.Text)
	}
}

func TestReadRowsCRLFAndNoTrailingNewline(t *testing.T) {
	f := openFixture(t, []byte("first\r\nsecond\r\nlast-no-eol"))
	got := readRows(f, []int{0, 1, 2})

	cases := map[int]string{0: "first", 1: "second", 2: "last-no-eol"}
	for row, want := range cases {
		ln, ok := got[row]
		if !ok {
			t.Fatalf("row %d missing", row)
		}
		if ln.Text != want {
			t.Errorf("row %d = %q, want %q", row, ln.Text, want)
		}
	}
}

func TestReadRowsPastEOF(t *testing.T) {
	f := openFixture(t, []byte("only-line\n"))
	got := readRows(f, []int{0, 5})

	if ln, ok := got[0]; !ok || ln.Text != "only-line" {
		t.Errorf("row 0 = %+v, want Text \"only-line\"", ln)
	}
	ln, ok := got[5]
	if !ok {
		t.Fatal("row 5 missing")
	}
	if ln.Note != "line 6 past end of file" {
		t.Errorf("row 5 Note = %q, want \"line 6 past end of file\"", ln.Note)
	}
}

func TestReadRowsNULByte(t *testing.T) {
	f := openFixture(t, []byte("before\x00after\nnext\n"))
	got := readRows(f, []int{0, 1})

	ln0, ok := got[0]
	if !ok {
		t.Fatal("row 0 missing")
	}
	if ln0.Note != "binary content" {
		t.Errorf("row 0 Note = %q, want \"binary content\"", ln0.Note)
	}
	if ln1, ok := got[1]; !ok || ln1.Text != "next" {
		t.Errorf("row 1 = %+v, want Text \"next\"", ln1)
	}
}

func TestReadRowsWhitespaceOnly(t *testing.T) {
	f := openFixture(t, []byte("   \t  \nnext\n"))
	got := readRows(f, []int{0, 1})

	if _, ok := got[0]; ok {
		t.Errorf("row 0 present, want no entry for a whitespace-only line: %+v", got[0])
	}
	if ln1, ok := got[1]; !ok || ln1.Text != "next" {
		t.Errorf("row 1 = %+v, want Text \"next\"", ln1)
	}
}

func TestReadRowsInteriorTabAndControlByte(t *testing.T) {
	f := openFixture(t, []byte("a\tb\x01c\n"))
	got := readRows(f, []int{0})

	ln, ok := got[0]
	if !ok {
		t.Fatal("row 0 missing")
	}
	want := "a b�c"
	if ln.Text != want {
		t.Errorf("Text = %q, want %q", ln.Text, want)
	}
}
