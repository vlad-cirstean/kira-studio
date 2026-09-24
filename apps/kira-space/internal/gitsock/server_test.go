package gitsock

import (
	"net"
	"testing"
)

// TestServer_TrackConn_RefusesAfterClose is P108 Part 17 review F4(a)'s own regression guard:
// Accept can return just before Close's own ln.Close() runs; before this fix, a connection tracked
// after Close had already flipped s.listening (but before it snapshotted allConns) was silently
// left out of that snapshot and never closed, blocking Close's own wg.Wait() forever behind a
// connection whose handleConn goroutine was already counted in wg. trackConn now checks
// s.listening under the same lock Close flips it under, so the ordering is deterministic: refuse
// and close immediately once Close has started.
func TestServer_TrackConn_RefusesAfterClose(t *testing.T) {
	s := New(Deps{})
	s.listening = true

	nc1, nc1Peer := net.Pipe()
	t.Cleanup(func() { _ = nc1.Close(); _ = nc1Peer.Close() })
	if !s.trackConn(nc1) {
		t.Fatal("trackConn while listening = true, want true (admitted)")
	}
	if _, ok := s.allConns[nc1]; !ok {
		t.Fatal("trackConn while listening = true: connection not added to allConns")
	}

	// Simulate Close() having already flipped s.listening — its own first step, under s.mu, before
	// it closes the listener or snapshots allConns (Close's own doc comment).
	s.mu.Lock()
	s.listening = false
	s.mu.Unlock()

	nc2, nc2Peer := net.Pipe()
	t.Cleanup(func() { _ = nc2.Close(); _ = nc2Peer.Close() })
	if s.trackConn(nc2) {
		t.Fatal("trackConn after listening = false, want false — Close has already started shutting down")
	}
	if _, ok := s.allConns[nc2]; ok {
		t.Fatal("trackConn after listening = false: connection must not be added to allConns")
	}
	// nc2 must have been closed immediately — its peer's read now observes the close rather than
	// blocking forever, exactly the hang this fix prevents.
	buf := make([]byte, 1)
	if _, err := nc2Peer.Read(buf); err == nil {
		t.Fatal("nc2's peer read did not observe a close — trackConn did not actually close the refused connection")
	}
}
