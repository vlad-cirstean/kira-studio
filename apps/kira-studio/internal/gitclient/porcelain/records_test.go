package porcelain

import (
	"bytes"
	"reflect"
	"testing"
)

func TestRecordSplitter_SplitAcrossThreePushes(t *testing.T) {
	s := NewRecordSplitter(0)
	full := []byte("recordAAAA\x00recordB\x00")
	var got [][]byte
	for _, chunk := range [][]byte{full[:3], full[3:12], full[12:]} {
		recs, err := s.Push(chunk)
		if err != nil {
			t.Fatalf("Push: %v", err)
		}
		got = append(got, recs...)
	}
	want := [][]byte{[]byte("recordAAAA"), []byte("recordB")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if flushed := s.Flush(); flushed != nil {
		t.Fatalf("Flush after a fully-terminated stream: got %q, want nil", flushed)
	}
}

func TestRecordSplitter_DelimiterAsFirstAndLastByteOfAChunk(t *testing.T) {
	s := NewRecordSplitter(0)
	recs1, err := s.Push([]byte("\x00tail"))
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if len(recs1) != 1 || string(recs1[0]) != "" {
		t.Fatalf("first push: got %q, want one empty record (a leading delimiter with nothing before it)", recs1)
	}
	recs2, err := s.Push([]byte("more\x00"))
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if len(recs2) != 1 || string(recs2[0]) != "tailmore" {
		t.Fatalf("second push: got %q, want [tailmore]", recs2)
	}
	if flushed := s.Flush(); flushed != nil {
		t.Fatalf("Flush: got %q, want nil (terminator was the very last byte)", flushed)
	}
}

func TestRecordSplitter_NoTrailingEmptyRecordAfterFinalNUL(t *testing.T) {
	s := NewRecordSplitter(0)
	recs, err := s.Push([]byte("a\x00b\x00"))
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	want := [][]byte{[]byte("a"), []byte("b")}
	if !reflect.DeepEqual(recs, want) {
		t.Fatalf("got %q, want %q (no bogus third empty record)", recs, want)
	}
}

func TestRecordSplitter_FlushSurfacesAGenuinePartialRecord(t *testing.T) {
	s := NewRecordSplitter(0)
	if _, err := s.Push([]byte("a\x00partial-tail-no-terminator")); err != nil {
		t.Fatalf("Push: %v", err)
	}
	flushed := s.Flush()
	if string(flushed) != "partial-tail-no-terminator" {
		t.Fatalf("Flush: got %q", flushed)
	}
	if second := s.Flush(); second != nil {
		t.Fatalf("second Flush: got %q, want nil", second)
	}
}

func TestRecordSplitter_RemainderCap(t *testing.T) {
	s := NewRecordSplitter(0)
	huge := bytes.Repeat([]byte("x"), maxRemainderBytes+1)
	_, err := s.Push(huge)
	if err != ErrRecordTooLarge {
		t.Fatalf("got %v, want ErrRecordTooLarge", err)
	}
}

func TestSplitLimitedFields_FinalFieldAbsorbsExtraDelimiters(t *testing.T) {
	got := SplitLimitedFields([]byte("a\x1fb\x1fc\x1fd\x1fe"), 0x1f, 3)
	want := [][]byte{[]byte("a"), []byte("b"), []byte("c\x1fd\x1fe")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSplitLimitedFields_TooFewDelimiters(t *testing.T) {
	got := SplitLimitedFields([]byte("a\x1fb"), 0x1f, 5)
	want := [][]byte{[]byte("a"), []byte("b")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q (fewer than n fields when the record is malformed)", got, want)
	}
}
