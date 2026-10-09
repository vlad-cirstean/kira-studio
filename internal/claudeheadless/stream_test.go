package claudeheadless

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func feedFile(t *testing.T, name string) (lines []Line) {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		lines = append(lines, parseLine(sc.Text())...)
	}
	return lines
}

func TestParserLogLines(t *testing.T) {
	lines := feedFile(t, "taskcreate.jsonl")
	text := joinLines(lines)
	for _, frag := range []string{"session 33f903aa", "▸ Bash echo hi", "▸ TaskCreate", "result: success · 7 turns", "Done."} {
		if !strings.Contains(text, frag) {
			t.Errorf("log lacks %q:\n%s", frag, text)
		}
	}
}

func TestParserDenialAndOversize(t *testing.T) {
	lines := feedFile(t, "denied.jsonl")
	text := joinLines(lines)
	for _, frag := range []string{"▸ Bash touch x", "denied: Bash", "✕ Permission to use Bash has been denied."} {
		if !strings.Contains(text, frag) {
			t.Errorf("log lacks %q:\n%s", frag, text)
		}
	}
	if strings.Contains(text, "rm y") || strings.Contains(text, "more") {
		t.Errorf("only the first line of a command / error belongs in the log:\n%s", text)
	}
	got := parseLine(`{"type":"assistant","message":{"content":[{"type":"tex…`)
	if len(got) != 1 || got[0].Stream != StreamStdout {
		t.Fatalf("unparseable line = %v, want one raw stdout line", got)
	}
}

func TestLineWriterCapsLongLine(t *testing.T) {
	var got []string
	w := newLineWriter(func(s string) { got = append(got, s) })
	chunk := strings.Repeat("x", 1<<20)
	for i := 0; i < maxStreamLine>>20+2; i++ {
		_, _ = w.Write([]byte(chunk))
	}
	_, _ = w.Write([]byte("\nnext\n"))
	if len(got) != 2 || got[1] != "next" || !strings.HasSuffix(got[0], "…") || len(got[0]) > maxStreamLine+4 {
		t.Fatalf("got %d lines, first len %d", len(got), len(got[0]))
	}
}

func joinLines(lines []Line) string {
	var sb strings.Builder
	for _, l := range lines {
		sb.WriteString(l.Text)
		sb.WriteByte('\n')
	}
	return sb.String()
}
