package adapterhost

import (
	"testing"
	"time"
)

// fakeConn is a StreamSession that records every frame handed to Send.
type fakeConn struct {
	sent chan []byte
}

func newFakeConn() *fakeConn { return &fakeConn{sent: make(chan []byte, 16)} }

func (c *fakeConn) Send(frame []byte) error {
	c.sent <- frame
	return nil
}
func (c *fakeConn) Receive() ([]byte, error) { select {} }

func newTestSession() (*Session, *fakeConn) {
	conn := newFakeConn()
	return newSession(conn), conn
}

// enqueue reports ErrStreamFull once both the frame-count and byte bounds are exhausted.
func TestSession_Enqueue_ReportsStreamFullOnceQueueSaturated(t *testing.T) {
	conn := &blockingConn{}
	s := newSession(conn)
	defer s.Close()

	// The writer goroutine pulls one frame out and blocks forever trying to send it
	// (blockingConn.Send never returns), so the channel buffer (capacity sessionQueueFrames)
	// fills from the rest. A generous overshoot makes this deterministic regardless of exactly
	// when the writer's one pull happens relative to this loop.
	sawFull := false
	for i := 0; i < sessionQueueFrames*3; i++ {
		if err := s.enqueue([]byte("x")); err != nil {
			sawFull = true
			break
		}
	}
	if !sawFull {
		t.Fatal("expected the queue to report full once saturated")
	}
}

type blockingConn struct{}

func (blockingConn) Send(frame []byte) error  { select {} }
func (blockingConn) Receive() ([]byte, error) { select {} }

// P2 R1: unlike enqueueLocal's events, enqueueResponse must never drop a response frame on a
// saturated queue — that frame is the only way a renderer-side pending request (which has no
// client-side timeout of its own, §5.1/D25) ever settles. It blocks for room instead, and
// unblocks once the session closes rather than hanging forever.
func TestSession_EnqueueResponse_BlocksInsteadOfDroppingUntilRoomOrClose(t *testing.T) {
	conn := &blockingConn{}
	s := newSession(conn)

	// The writer goroutine's one-time pull (it then blocks forever inside blockingConn.Send) only
	// happens once there is something to pull — seed one frame and give it a moment to be picked
	// up first, so that pull can't race with (and later free a slot out from under) the saturating
	// loop below, which needs the queue to stay genuinely, permanently full.
	if err := s.enqueue([]byte("seed")); err != nil {
		t.Fatalf("setup: seed enqueue: %v", err)
	}
	time.Sleep(20 * time.Millisecond)

	for i := 0; i < sessionQueueFrames; i++ {
		if err := s.enqueue([]byte("x")); err != nil {
			t.Fatalf("setup: enqueue %d: %v", i, err)
		}
	}
	if err := s.enqueue([]byte("y")); err == nil {
		t.Fatal("setup: expected the queue to already be full")
	}

	done := make(chan struct{})
	go func() {
		s.enqueueResponse([]byte("response"))
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("enqueueResponse returned immediately on a full queue, want it to block for room")
	case <-time.After(50 * time.Millisecond):
	}

	s.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("enqueueResponse never returned after the session closed")
	}
}
