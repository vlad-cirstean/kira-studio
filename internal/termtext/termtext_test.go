package termtext

import (
	"strings"
	"testing"
)

func TestSanitizeLine_InvalidUTF8ReplacedWithReplacementChar(t *testing.T) {
	raw := "hello \xff\xfe world"
	got := SanitizeLine(raw)
	if !strings.Contains(got, "�") {
		t.Fatalf("got %q, want a replacement char", got)
	}
	if strings.Contains(got, "\xff") || strings.Contains(got, "\xfe") {
		t.Fatalf("got %q, invalid bytes survived", got)
	}
}

func TestSanitizeLine_StripsC0ControlBytesExceptTab(t *testing.T) {
	raw := "a\x01b\x07c\td\x1fe"
	got := SanitizeLine(raw)
	want := "abc\tde"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSanitizeLine_StripsDEL(t *testing.T) {
	got := SanitizeLine("a\x7fb")
	if got != "ab" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_StripsCSI(t *testing.T) {
	raw := "\x1b[31mred\x1b[0m plain"
	got := SanitizeLine(raw)
	if got != "red plain" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_StripsOSC(t *testing.T) {
	// OSC terminated by BEL, and OSC terminated by ESC \.
	raw := "before\x1b]0;window title\x07after\x1b]8;;http://x\x1b\\end"
	got := SanitizeLine(raw)
	if got != "beforeafterend" {
		t.Fatalf("got %q", got)
	}
}

func TestSanitizeLine_UnterminatedEscapeDropped(t *testing.T) {
	got := SanitizeLine("keep\x1b[31")
	if got != "keep" {
		t.Fatalf("got %q", got)
	}
}

// TestSanitizeLine_PlainTextUnaffected: SanitizeLine is only ever called on one already
// newline-split line (never one still containing an embedded '\n', which the C0-strip rule would
// otherwise remove along with every other control byte) — ordinary printable text passes through
// byte for byte.
func TestSanitizeLine_PlainTextUnaffected(t *testing.T) {
	got := SanitizeLine("installing deps... done (1/1)")
	if got != "installing deps... done (1/1)" {
		t.Fatalf("got %q", got)
	}
}

func TestTail_EscapeSplitAcrossWrites(t *testing.T) {
	tl := NewTail(1024)
	tl.Write([]byte("\x1b[3"))
	tl.Write([]byte("1mboom\x1b[0m\r\n"))
	if got := tl.Lines(10); got != "boom" {
		t.Fatalf("got %q", got)
	}
}

func TestTail_CarriageReturnKeepsLastRedraw(t *testing.T) {
	tl := NewTail(1024)
	tl.Write([]byte("10%\r50%\r100%\ndone\n"))
	if got := tl.Lines(10); got != "100%\ndone" {
		t.Fatalf("got %q", got)
	}
}

func TestTail_LineCapKeepsEnd(t *testing.T) {
	tl := NewTail(1024)
	tl.Write([]byte("a\nb\n\nc\nd\n"))
	if got := tl.Lines(2); got != "c\nd" {
		t.Fatalf("got %q", got)
	}
}

func TestTail_ByteCapDropsPartialLeadingLine(t *testing.T) {
	tl := NewTail(16)
	tl.Write([]byte("héllo wörld line\nsecond\nthird\n"))
	got := tl.Lines(10)
	if got != "second\nthird" {
		t.Fatalf("got %q", got)
	}
	if strings.ContainsRune(got, 0xFFFD) {
		t.Fatalf("split rune leaked: %q", got)
	}
}

func TestTail_UnterminatedLastLineKept(t *testing.T) {
	tl := NewTail(1024)
	tl.Write([]byte("one\ntwo"))
	if got := tl.Lines(10); got != "one\ntwo" {
		t.Fatalf("got %q", got)
	}
}
