package enginehost

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
	"testing/iotest"
)

func TestFrameRoundTrip(t *testing.T) {
	tests := []struct {
		tag byte
		n   int
	}{
		{0, 0},
		{1, 1},
		{0, 1024},
		{1, 1 << 20},
	}
	for _, tt := range tests {
		body := bytes.Repeat([]byte{0xAB}, tt.n)
		encoded := encodeFrame(tt.tag, body)
		gotTag, gotBody, err := readFrame(bytes.NewReader(encoded))
		if err != nil {
			t.Fatalf("readFrame: %v", err)
		}
		if gotTag != tt.tag {
			t.Errorf("tag = %d, want %d", gotTag, tt.tag)
		}
		if !bytes.Equal(gotBody, body) {
			t.Errorf("body length %d != %d or content mismatch", len(gotBody), len(body))
		}
	}
}

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

func TestReadFrameRejectsOversizeLength(t *testing.T) {
	var hdr [frameHeaderLen]byte
	binary.BigEndian.PutUint32(hdr[:4], maxFrameBytes+1)
	_, _, err := readFrame(bytes.NewReader(hdr[:]))
	if err != errFrameTooLarge {
		t.Fatalf("readFrame() error = %v, want errFrameTooLarge", err)
	}
}

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

func TestReadFrameTruncatedBody(t *testing.T) {
	var hdr [frameHeaderLen]byte
	binary.BigEndian.PutUint32(hdr[:4], 10)
	hdr[4] = 0
	buf := append(hdr[:], []byte("short")...) // 5 bytes body, but header claims 10
	_, _, err := readFrame(bytes.NewReader(buf))
	if err != io.ErrUnexpectedEOF {
		t.Fatalf("readFrame() error = %v, want io.ErrUnexpectedEOF", err)
	}
}
