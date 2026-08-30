package enginehost

import (
	"encoding/binary"
	"errors"
	"io"
)

// Wire format (P54 §3): | length uint32 BE | tag uint8 | body (length bytes) |. length is the
// body's byte length and excludes the tag byte. tag 0 = control (parsed by Go), tag 1 = data
// (opaque to Go, handed to a Sink verbatim). The Node counterpart is src/engine/stdio-main.ts's
// writeFrame/the stdin 'data' handler.
const (
	frameTagControl byte = 0
	frameTagData    byte = 1
	frameHeaderLen       = 5

	// maxFrameBytes guards the length prefix against a desync turning garbage bytes into a huge
	// allocation (D2) — a protocol error, not a policy limit. Compare maxDataFrameBytes in
	// stream.go, which is a policy limit on what may be handed to a Sink.
	maxFrameBytes = 128 << 20
)

var errFrameTooLarge = errors.New("enginehost: frame length exceeds the protocol limit")

// readFrame reads one length-prefixed, tagged frame from r. body is a freshly allocated slice
// sized exactly to the frame — never a sub-slice of a larger buffer — so a data frame can be
// handed to a Sink without a copy and without aliasing anything the reader touches again (P52
// §7.2's zero-copy Send contract).
func readFrame(r io.Reader) (tag byte, body []byte, err error) {
	var hdr [frameHeaderLen]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:4])
	if n > maxFrameBytes {
		return 0, nil, errFrameTooLarge
	}
	tag = hdr[4]
	body = make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return 0, nil, err
	}
	return tag, body, nil
}

// encodeFrame returns one buffer holding the whole frame, so the caller can issue one Write —
// splitting the header and body into two writes would let a concurrent writer interleave its own
// frame in between (P54 §5.2's TestConcurrentCallsDoNotInterleaveFrames).
func encodeFrame(tag byte, body []byte) []byte {
	frame := make([]byte, frameHeaderLen+len(body))
	binary.BigEndian.PutUint32(frame[:4], uint32(len(body)))
	frame[4] = tag
	copy(frame[frameHeaderLen:], body)
	return frame
}
