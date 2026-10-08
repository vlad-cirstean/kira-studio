package mobileterm

import (
	"bytes"
	"testing"
)

func TestRing_WrapAndResume(t *testing.T) {
	r := newRing(8)
	r.Append([]byte("abcdef"))
	r.Append([]byte("ghij")) // window now "cdefghij", start 2
	data, end := r.Snapshot()
	if string(data) != "cdefghij" || end != 10 {
		t.Fatalf("snapshot = %q, %d", data, end)
	}
	data, next, over := r.ReadFrom(6, 100)
	if string(data) != "ghij" || next != 10 || over {
		t.Fatalf("resume = %q, %d, %v", data, next, over)
	}
	data, next, over = r.ReadFrom(1, 3)
	if string(data) != "cde" || next != 5 || !over {
		t.Fatalf("overrun = %q, %d, %v", data, next, over)
	}
	if data, next, _ = r.ReadFrom(10, 4); len(data) != 0 || next != 10 {
		t.Fatalf("at end = %q, %d", data, next)
	}
}

func TestRing_OversizeAppendKeepsTail(t *testing.T) {
	r := newRing(4)
	r.Append([]byte("0123456789"))
	data, end := r.Snapshot()
	if !bytes.Equal(data, []byte("6789")) || end != 10 {
		t.Fatalf("snapshot = %q, %d", data, end)
	}
}
