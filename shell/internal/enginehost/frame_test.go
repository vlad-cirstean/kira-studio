package enginehost

import (
	"bytes"
	"testing"
	"testing/iotest"
)

// TestReadFrameHandlesSplitReads covers the framer's whole reason to exist: pipe reads never line
// up with frame boundaries, so readFrame must reassemble a run of frames byte by byte without
// losing or merging any of them.
func TestReadFrameHandlesSplitReads(t *testing.T) {
	var buf bytes.Buffer
	buf.Write(encodeFrame(0, []byte("one")))
	buf.Write(encodeFrame(1, []byte("two")))
	buf.Write(encodeFrame(0, []byte("three")))

	r := iotest.OneByteReader(bytes.NewReader(buf.Bytes()))
	want := []struct {
		tag  byte
		body string
	}{
		{0, "one"}, {1, "two"}, {0, "three"},
	}
	for _, w := range want {
		tag, body, err := readFrame(r)
		if err != nil {
			t.Fatalf("readFrame: %v", err)
		}
		if tag != w.tag || string(body) != w.body {
			t.Errorf("readFrame() = (%d, %q), want (%d, %q)", tag, body, w.tag, w.body)
		}
	}
}
