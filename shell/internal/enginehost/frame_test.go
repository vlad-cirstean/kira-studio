package enginehost

import (
	"bytes"
	"encoding/binary"
	"testing"
	"testing/iotest"
)

// TestEncodeFrameLayout pins the exact byte layout the Node counterpart's writeFrame must agree
// with: a big-endian length prefix that counts the BODY only (not the tag byte), then the tag,
// then the body. An off-by-one here desynchronises the stream in a way nothing else reports.
func TestEncodeFrameLayout(t *testing.T) {
	body := []byte("hello")
	encoded := encodeFrame(1, body)
	if len(encoded) != frameHeaderLen+len(body) {
		t.Fatalf("len(encoded) = %d, want %d", len(encoded), frameHeaderLen+len(body))
	}
	gotLen := binary.BigEndian.Uint32(encoded[:4])
	if int(gotLen) != len(body) {
		t.Errorf("length prefix = %d, want the body length %d (not body+1)", gotLen, len(body))
	}
	if encoded[4] != 1 {
		t.Errorf("tag byte = %d, want 1", encoded[4])
	}
	if !bytes.Equal(encoded[5:], body) {
		t.Errorf("body bytes = %v, want %v", encoded[5:], body)
	}
}

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
