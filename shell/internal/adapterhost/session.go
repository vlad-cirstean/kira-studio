package adapterhost

import (
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
)

// ErrStreamFull is what enqueue returns when the session's queue has no room for a frame right
// now. Moved from enginehost (P58f D9): HandleDataFrame's own dispatch is the only caller of
// enqueue/enqueueLocal, and enginehost's own retry-with-backoff around it (stream.go) has no
// counterpart here — a locally-produced or forwarded frame that finds the queue full is dropped,
// not retried (enqueueLocal's own comment explains why).
var ErrStreamFull = errors.New("adapterhost: stream sink full")

// StreamSession is the whole of what the router needs from a renderer connection — the same
// method set as bridge.StreamSession (A11's per-consumer-interface discipline; this package must
// not import bridge or Wails, the same rule P54 §2 D14 gives enginehost.Sink).
type StreamSession interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}

const (
	// sessionQueueFrames/sessionQueueBytes match enginehost/stream.go's own dataQueueFrames/
	// dataQueueBytes (64 frames / 32 MiB) — the router's queue replaces that one as the thing
	// backpressure now bounds.
	sessionQueueFrames = 64
	sessionQueueBytes  = 32 << 20

	// maxDataFrameBytes mirrors Wails' own streamMaxFrameBytes, same as enginehost's own copy of
	// this constant. A pathological Go-produced page can approach it (MaxPageSize 10 000 rows,
	// MaxCellBytes 64 KiB, base64 inflating by 1.33x, §4.10) — this is the check that catches it.
	maxDataFrameBytes = 64 << 20
)

// Session is A18: one writer goroutine per attached renderer connection, owning a bounded queue
// that both producers enqueue into — the engine child's own data frames (via Send, satisfying
// enginehost.Sink) and HandleDataFrame's own locally-produced responses (via enqueueLocal).
// Two goroutines calling a blocking conn.Send directly would be a data race waiting to be found on
// macOS (application.StreamConn.Send blocks; TrySend is the non-blocking one) — this is what
// keeps there being exactly one caller of conn.Send.
type Session struct {
	router *Router
	conn   StreamSession

	queue       chan []byte
	queuedBytes atomic.Int64
	done        chan struct{}
	closeOnce   sync.Once
}

func newSession(router *Router, conn StreamSession) *Session {
	s := &Session{router: router, conn: conn, queue: make(chan []byte, sessionQueueFrames), done: make(chan struct{})}
	go s.writeLoop()
	return s
}

func (s *Session) writeLoop() {
	for {
		select {
		case frame, ok := <-s.queue:
			if !ok {
				return
			}
			s.queuedBytes.Add(-int64(len(frame)))
			if err := s.conn.Send(frame); err != nil {
				s.Close()
				return
			}
		case <-s.done:
			return
		}
	}
}

// Send is enginehost.Sink's method: every data frame the engine child produces arrives here.
// A16's passive stats merge starts with a peek at this exact frame, before it ever reaches the
// queue — see router.go's observeChildEvent.
func (s *Session) Send(frame []byte) error {
	s.router.observeChildEvent(frame)
	return s.enqueue(frame)
}

// enqueueLocal is HandleDataFrame's own path for a frame this process produced itself (a native
// dispatcher's response, a merged cache:stats answer). Unlike enginehost's own deliver(), there is
// no retry-with-backoff here: a locally-produced response has no OS pipe to push back through, so
// a full queue just drops the frame — the renderer's own pending request then times out exactly as
// it would if the process had died, which port.ts already handles, rather than blocking whichever
// goroutine hit the full queue.
func (s *Session) enqueueLocal(frame []byte) {
	if err := s.enqueue(frame); err != nil {
		slog.Warn("adapterhost: dropping a response frame, session queue full", "scope", "adapterhost")
	}
}

func (s *Session) enqueue(frame []byte) error {
	if len(frame) > maxDataFrameBytes {
		slog.Error("adapterhost: dropping oversized data frame", "scope", "adapterhost",
			"bytes", len(frame), "limit", maxDataFrameBytes)
		return nil
	}
	if s.queuedBytes.Load() >= sessionQueueBytes {
		return ErrStreamFull
	}
	select {
	case s.queue <- frame:
		s.queuedBytes.Add(int64(len(frame)))
		return nil
	default:
		return ErrStreamFull
	}
}

// Close stops this session's writer goroutine. Idempotent.
func (s *Session) Close() {
	s.closeOnce.Do(func() { close(s.done) })
}
