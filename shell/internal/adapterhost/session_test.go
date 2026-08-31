package adapterhost

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
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
	r := NewRouter(adapters.Deps{}, enginecache.NewCache(enginecache.DefaultPageBudgetBytes, nil), nil, fakeKindLookup{})
	return newSession(r, conn), conn
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
