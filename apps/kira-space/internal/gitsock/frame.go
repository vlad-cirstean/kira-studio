// Package gitsock is the Unix-socket server SPEC §3 describes: listener, lock-guarded stale-socket
// recovery, length-prefixed JSON framing, the pairing handshake, and the live-connection registry
// that backs revocation. It is the transport package that sits beside internal/bridge (the Wails
// side of the same job) rather than underneath it — internal/layering_test.go exempts it from the
// domain-package bridge-import check for exactly that reason (it needs rpcstream.Conn/Serve).
package gitsock

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
)

// maxFrameBytes is the post-handshake frame cap, 32 MiB: a pathological repository's graph chunk
// or commit detail can be large. Twins: bridge maxGitStreamFrameBytes, git-ipc
// MAX_FRAME_BYTES. A longer prefix is a hard connection error, not a truncation.
const maxFrameBytes = 32 << 20

// handshakeMaxFrameBytes caps reads before the handshake succeeds: the hello is a few hundred
// bytes, and an unauthenticated peer must not make the server allocate maxFrameBytes.
const handshakeMaxFrameBytes = 64 << 10

var errFrameTooLarge = errors.New("gitsock: frame exceeds maxFrameBytes")

// frameHeaderLen is D2's 4-byte big-endian length prefix.
const frameHeaderLen = 4

// writeFrame writes b as one length-prefixed frame in a single Write call — concatenating the
// header and body first rather than writing them separately, so two frames from concurrent
// writers (there are none today; §5.3's socketChannel.ts states the same discipline) can never
// interleave on the wire.
func writeFrame(w io.Writer, b []byte) error {
	if len(b) > maxFrameBytes {
		return errFrameTooLarge
	}
	buf := make([]byte, frameHeaderLen+len(b))
	binary.BigEndian.PutUint32(buf[:frameHeaderLen], uint32(len(b)))
	copy(buf[frameHeaderLen:], b)
	_, err := w.Write(buf)
	return err
}

// readFrame reads one length-prefixed frame. A length prefix over the cap is refused before any
// body byte is read; a prefix promising more than actually arrives surfaces as an error from
// io.ReadFull (typically io.ErrUnexpectedEOF or io.EOF) rather than blocking — io.ReadFull returns
// as soon as the underlying reader reports it can supply no more.
func readFrame(r *bufio.Reader, limit uint32) ([]byte, error) {
	var hdr [frameHeaderLen]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > limit {
		return nil, errFrameTooLarge
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}

// conn adapts a net.Conn to rpcstream.Conn's two-method Send/Receive seam (F2) — the ~40-line
// adapter the whole package exists to provide. It is also what the handshake reads and writes
// directly, before rpcstream.Serve ever sees the connection (D21): the bufio.Reader is created
// once per accepted connection and carries over unchanged from the handshake into Serve, so a
// frame boundary is never miscounted across that handoff.
type conn struct {
	nc    net.Conn
	r     *bufio.Reader
	limit atomic.Uint32 // read cap; handshakeMaxFrameBytes until the handshake succeeds
	mu    sync.Mutex    // serializes Send; rpcstream's own session already funnels writes through one
	// goroutine once Serve is running, but the handshake writes directly too, before that exists.
}

func newConn(nc net.Conn) *conn {
	c := &conn{nc: nc, r: bufio.NewReader(nc)}
	c.limit.Store(handshakeMaxFrameBytes)
	return c
}

func (c *conn) setLimit(n uint32) { c.limit.Store(n) }

func (c *conn) Send(frame []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return writeFrame(c.nc, frame)
}

func (c *conn) Receive() ([]byte, error) {
	return readFrame(c.r, c.limit.Load())
}
