package docker

import (
	"reflect"
	"strings"
	"testing"
)

func texts(lines []LogLine) []string {
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		out = append(out, l.Stream+":"+l.Text)
	}
	return out
}

func TestLineFramerSplitsAcrossChunks(t *testing.T) {
	f := newLineFramer(false)
	var got []LogLine
	for _, chunk := range []string{"hel", "lo\nwor", "ld\n", "tail"} {
		got = append(got, f.write("stdout", []byte(chunk))...)
	}
	want := []string{"stdout:hello", "stdout:world"}
	if !reflect.DeepEqual(texts(got), want) {
		t.Fatalf("got %v, want %v", texts(got), want)
	}
	if rest := f.flush(); !reflect.DeepEqual(texts(rest), []string{"stdout:tail"}) {
		t.Fatalf("flush got %v", texts(rest))
	}
	if again := f.flush(); len(again) != 0 {
		t.Fatalf("second flush must be empty, got %v", texts(again))
	}
}

func TestLineFramerInterleavedStreams(t *testing.T) {
	f := newLineFramer(false)
	var got []LogLine
	got = append(got, f.write("stdout", []byte("out-"))...)
	got = append(got, f.write("stderr", []byte("err-"))...)
	got = append(got, f.write("stdout", []byte("one\n"))...)
	got = append(got, f.write("stderr", []byte("two\n"))...)
	want := []string{"stdout:out-one", "stderr:err-two"}
	if !reflect.DeepEqual(texts(got), want) {
		t.Fatalf("got %v, want %v", texts(got), want)
	}
}

func TestLineFramerCRLFAndBlankLines(t *testing.T) {
	f := newLineFramer(false)
	got := f.write("stdout", []byte("a\r\n\nb\r\r\n"))
	want := []string{"stdout:a", "stdout:", "stdout:b\r"}
	if !reflect.DeepEqual(texts(got), want) {
		t.Fatalf("got %q, want %q", texts(got), want)
	}
}

func TestLineFramerTruncatesLongLine(t *testing.T) {
	f := newLineFramer(false)
	long := strings.Repeat("x", maxLogLine+5000)
	var got []LogLine
	got = append(got, f.write("stdout", []byte(long[:70000]))...)
	got = append(got, f.write("stdout", []byte(long[70000:]+"\nnext\n"))...)
	if len(got) != 2 {
		t.Fatalf("want a truncated line then next, got %d lines", len(got))
	}
	if want := strings.Repeat("x", maxLogLine) + truncationMarker; got[0].Text != want {
		t.Fatalf("truncated line has %d bytes, want %d", len(got[0].Text), len(want))
	}
	if got[1].Text != "next" {
		t.Fatalf("line after a truncated one lost: %q", got[1].Text)
	}
}

func TestLineFramerTruncatesCompleteLongLine(t *testing.T) {
	f := newLineFramer(false)
	got := f.write("stdout", []byte(strings.Repeat("y", maxLogLine+1)+"\n"))
	if len(got) != 1 || !strings.HasSuffix(got[0].Text, truncationMarker) {
		t.Fatalf("got %d lines", len(got))
	}
}

func TestLineFramerTimestamps(t *testing.T) {
	f := newLineFramer(true)
	got := f.write("stdout", []byte("2026-01-02T03:04:05.123456789Z hello world\nnot-a-timestamp line\n"))
	if got[0].TS != "2026-01-02T03:04:05.123456789Z" || got[0].Text != "hello world" {
		t.Fatalf("timestamp split wrong: %+v", got[0])
	}
	if got[1].TS != "" || got[1].Text != "not-a-timestamp line" {
		t.Fatalf("non-timestamp prefix must stay in text: %+v", got[1])
	}
}
