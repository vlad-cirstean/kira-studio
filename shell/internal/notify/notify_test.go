package notify_test

import (
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/notify"
)

// TestReentrantSubscribeDoesNotDeadlock guards Emit's snapshot-then-call-with-the-lock-released
// shape: a callback that subscribes (or unsubscribes, or emits) re-entrantly must not deadlock on
// the emitter's own mutex.
func TestReentrantSubscribeDoesNotDeadlock(t *testing.T) {
	var e notify.Emitter[int]
	done := make(chan struct{}, 1)
	e.Subscribe(func(v int) {
		e.Subscribe(func(int) {})
		done <- struct{}{}
	})

	e.Emit(1)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Emit deadlocked on a re-entrant Subscribe")
	}
}

func TestConcurrentSubscribeAndEmit(t *testing.T) {
	var e notify.Emitter[int]
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			unsub := e.Subscribe(func(int) {})
			unsub()
		}()
		go func(v int) {
			defer wg.Done()
			e.Emit(v)
		}(i)
	}
	wg.Wait()
}
