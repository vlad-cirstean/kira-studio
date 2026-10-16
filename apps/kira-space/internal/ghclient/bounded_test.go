package ghclient

import (
	"io"
	"strings"
	"testing"
)

func TestBoundedWriter_ReportsFullLengthOnOverflow(t *testing.T) {
	w := &boundedWriter{max: 4}
	n, err := io.Copy(w, strings.NewReader("0123456789"))
	if err != nil || n != 10 {
		t.Fatalf("copy = %d, %v; want 10, nil", n, err)
	}
	if !w.overflow || w.buf.String() != "0123" {
		t.Fatalf("overflow = %v, buf = %q", w.overflow, w.buf.String())
	}
}
