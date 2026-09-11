package gitsock

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"io"
	"testing"
	"time"
)

func TestFrame_ZeroLengthBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := writeFrame(&buf, []byte{}); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := readFrame(bufio.NewReader(&buf))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
}

func TestFrame_OneByteUnderMax(t *testing.T) {
	t.Parallel()
	body := make([]byte, maxFrameBytes-1)
	var buf bytes.Buffer
	if err := writeFrame(&buf, body); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := readFrame(bufio.NewReader(&buf))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != len(body) {
		t.Fatalf("got %d bytes, want %d", len(got), len(body))
	}
}

func TestFrame_OneByteOverMax_WriteRefused(t *testing.T) {
	t.Parallel()
	body := make([]byte, maxFrameBytes+1)
	var buf bytes.Buffer
	if err := writeFrame(&buf, body); err != errFrameTooLarge {
		t.Fatalf("got %v, want errFrameTooLarge", err)
	}
	if buf.Len() != 0 {
		t.Fatalf("writeFrame wrote %d bytes despite refusing", buf.Len())
	}
}

func TestFrame_OneByteOverMax_ReadRefusedBeforeBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	var hdr [frameHeaderLen]byte
	binary.BigEndian.PutUint32(hdr[:], maxFrameBytes+1)
	buf.Write(hdr[:])
	// Deliberately no body bytes follow — if readFrame tried to allocate/read the body before
	// checking the cap, this would hang on io.ReadFull instead of erroring immediately.
	if _, err := readFrame(bufio.NewReader(&buf)); err != errFrameTooLarge {
		t.Fatalf("got %v, want errFrameTooLarge", err)
	}
}

func TestFrame_TruncatedNeverBlocksForever(t *testing.T) {
	t.Parallel()
	// A prefix promising 100 bytes with only 10 ever arriving, then EOF.
	var buf bytes.Buffer
	var hdr [frameHeaderLen]byte
	binary.BigEndian.PutUint32(hdr[:], 100)
	buf.Write(hdr[:])
	buf.Write(make([]byte, 10))

	done := make(chan error, 1)
	go func() {
		_, err := readFrame(bufio.NewReader(&buf))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("want an error for a truncated frame, got nil")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("readFrame blocked forever on a truncated frame")
	}
}

func TestFrame_TwoFramesInOneWrite(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := writeFrame(&buf, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := writeFrame(&buf, []byte("second")); err != nil {
		t.Fatal(err)
	}
	r := bufio.NewReader(&buf)
	got1, err := readFrame(r)
	if err != nil || string(got1) != "first" {
		t.Fatalf("first frame: got %q, err %v", got1, err)
	}
	got2, err := readFrame(r)
	if err != nil || string(got2) != "second" {
		t.Fatalf("second frame: got %q, err %v", got2, err)
	}
}

// stepReader hands its data back a few bytes at a time, forcing readFrame's io.ReadFull calls to
// span several underlying Reads for what writeFrame wrote as a single frame.
type stepReader struct {
	data []byte
	step int
}

func (r *stepReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := min(min(r.step, len(r.data)), len(p))
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func TestFrame_SplitAcrossThreeReads(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := writeFrame(&buf, []byte("hello world")); err != nil {
		t.Fatal(err)
	}
	// 15 total bytes (4-byte header + 11-byte body); a 5-byte step forces exactly three Reads.
	r := bufio.NewReader(&stepReader{data: buf.Bytes(), step: 5})
	got, err := readFrame(r)
	if err != nil || string(got) != "hello world" {
		t.Fatalf("got %q, err %v", got, err)
	}
}
