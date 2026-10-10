package linewriter

import (
	"strings"
	"testing"
)

func TestCapsLongLine(t *testing.T) {
	var got []string
	w := New(func(s string) { got = append(got, s) })
	chunk := strings.Repeat("x", 1<<20)
	for i := 0; i < MaxLine>>20+2; i++ {
		_, _ = w.Write([]byte(chunk))
	}
	_, _ = w.Write([]byte("\nnext\n"))
	if len(got) != 2 || got[1] != "next" || !strings.HasSuffix(got[0], "…") || len(got[0]) > MaxLine+4 {
		t.Fatalf("got %d lines, first len %d", len(got), len(got[0]))
	}
}
