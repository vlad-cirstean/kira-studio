package enginehost

import (
	"log/slog"
	"strings"
	"sync"
	"testing"
)

type recordingSink struct {
	mu     sync.Mutex
	frames [][]byte
}

func (s *recordingSink) Send(frame []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frames = append(s.frames, frame)
	return nil
}

func (s *recordingSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.frames)
}

// TestOversizeDataFrameIsDropped exercises deliver() directly against a bare *Host — no real
// engine child is needed since maxDataFrameBytes' guard runs before anything sink- or
// process-related matters (P54 §2 D10).
func TestOversizeDataFrameIsDropped(t *testing.T) {
	prev := maxDataFrameBytes
	maxDataFrameBytes = 1024
	t.Cleanup(func() { maxDataFrameBytes = prev })

	var logs strings.Builder
	prevLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prevLogger) })

	h := &Host{}
	sink := &recordingSink{}
	h.AttachStream(sink)

	h.deliver(make([]byte, 2048))
	if sink.count() != 0 {
		t.Fatalf("sink received an oversized frame, want it dropped")
	}
	if !strings.Contains(logs.String(), "oversized") {
		t.Errorf("no log line naming the oversized drop: %s", logs.String())
	}

	h.deliver(make([]byte, 512))
	if sink.count() != 1 {
		t.Errorf("sink.count() = %d after a normal-size frame, want 1 (the next frame must still flow)", sink.count())
	}
}
