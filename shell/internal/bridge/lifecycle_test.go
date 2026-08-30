package bridge_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
)

type recordingFlusher struct{ calls int }

func (r *recordingFlusher) Flushed() { r.calls++ }

func TestLifecycleFlushedCallsFlusher(t *testing.T) {
	f := &recordingFlusher{}
	svc := &bridge.LifecycleService{Flusher: f}
	svc.Flushed()
	if f.calls != 1 {
		t.Errorf("Flusher.Flushed called %d times, want 1", f.calls)
	}
}

func TestLifecycleFlushedNilFlusherIsANoop(t *testing.T) {
	svc := &bridge.LifecycleService{}
	svc.Flushed() // must not panic
}
