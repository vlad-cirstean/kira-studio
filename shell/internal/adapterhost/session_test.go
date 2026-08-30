package adapterhost

import (
	"bytes"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
)

func newTestSession() (*Session, *fakeConn) {
	conn := newFakeConn()
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	return newSession(r, conn), conn
}

func TestSession_WriteLoop_DeliversFramesInOrder(t *testing.T) {
	s, conn := newTestSession()
	defer s.Close()

	s.enqueueLocal([]byte("first"))
	s.enqueueLocal([]byte("second"))

	first := <-conn.sent
	second := <-conn.sent
	if !bytes.Equal(first, []byte("first")) || !bytes.Equal(second, []byte("second")) {
		t.Errorf("got %s, %s, want first, second in order", first, second)
	}
}

// An oversized frame is dropped, not enqueued — §4.10's own drop-with-a-named-log-line behaviour.
func TestSession_Enqueue_DropsOversizedFrame(t *testing.T) {
	s, conn := newTestSession()
	defer s.Close()

	huge := make([]byte, maxDataFrameBytes+1)
	if err := s.enqueue(huge); err != nil {
		t.Fatalf("enqueue of an oversized frame should report success-as-drop (nil), got %v", err)
	}
	select {
	case frame := <-conn.sent:
		t.Fatalf("an oversized frame must never reach the conn, got %d bytes", len(frame))
	case <-time.After(50 * time.Millisecond):
	}
}

// enqueue reports ErrStreamFull once both the frame-count and byte bounds are exhausted, and
// Session.Send (the enginehost.Sink method) propagates that unchanged — enginehost's own deliver()
// is what retries on it.
func TestSession_Enqueue_ReportsStreamFullOnceQueueSaturated(t *testing.T) {
	conn := &blockingConn{}
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	s := newSession(r, conn)
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
