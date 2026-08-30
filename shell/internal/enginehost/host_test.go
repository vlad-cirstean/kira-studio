package enginehost_test

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge/ipcerr"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

const fixture = "testdata/engine-fixture.mjs"

func asIpcErr(t *testing.T, err error) *ipcerr.Error {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	return ie
}

// TestEngineDownFailsPendingCalls covers waitAndFail's release of the pending-call map: every
// caller blocked in CallTimeout must be woken with E_ENGINE_DOWN when the child exits, rather
// than hanging until its own 30s timeout.
func TestEngineDownFailsPendingCalls(t *testing.T) {
	h := newHost(t, fixture)

	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := h.Call("crash", nil)
		results <- err
	}()
	go func() {
		defer wg.Done()
		_, err := h.CallTimeout("slow", nil, 5*time.Second)
		results <- err
	}()

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("pending calls did not fail within 2s of the engine crashing")
	}
	close(results)
	for err := range results {
		ie := asIpcErr(t, err)
		if ie.Code != "E_ENGINE_DOWN" || ie.Message != "engine process exited" {
			t.Errorf("pending call error = %+v, want {E_ENGINE_DOWN \"engine process exited\"}", ie)
		}
	}

	select {
	case <-h.Down():
	default:
		t.Error("Down() is not closed after engine exit")
	}
	if h.Alive() {
		t.Error("Alive() = true after engine exit")
	}
}

// TestEngineDownIsPublishedThenChannelsClose pins the shutdown ordering every subscriber depends
// on: engine:down must arrive as each subscriber's LAST event and only then may the channel
// close, and a subscription taken out after the exit must come back already closed.
func TestEngineDownIsPublishedThenChannelsClose(t *testing.T) {
	h := newHost(t, fixture)
	ch, unsub := h.Subscribe()
	defer unsub()

	if _, err := h.Call("crash", nil); err == nil {
		t.Fatal("Call(crash) = nil error, want E_ENGINE_DOWN")
	}

	select {
	case evt, ok := <-ch:
		if !ok {
			t.Fatal("channel closed before delivering engine:down")
		}
		if evt.Topic != enginehost.EventEngineDown {
			t.Errorf("last event topic = %q, want %q", evt.Topic, enginehost.EventEngineDown)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("engine:down was never published")
	}

	select {
	case _, ok := <-ch:
		if ok {
			t.Error("channel produced another event after engine:down; want it closed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("channel never closed after engine:down")
	}

	// Subscribing after exit returns an already-closed channel.
	lateCh, lateUnsub := h.Subscribe()
	defer lateUnsub()
	select {
	case _, ok := <-lateCh:
		if ok {
			t.Error("late Subscribe() channel produced a value, want it pre-closed")
		}
	default:
		t.Error("late Subscribe() channel did not read as closed immediately")
	}
}

// TestConcurrentCallsDoNotInterleaveFrames is the guard on encodeFrame's one-buffer-one-Write
// contract: 32 concurrent callers must each get their own answer back, which only holds while no
// writer can slip a frame between another's header and body.
func TestConcurrentCallsDoNotInterleaveFrames(t *testing.T) {
	h := newHost(t, fixture)
	const n = 32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			raw, err := h.Call("echo", map[string]any{"n": i})
			if err != nil {
				errs <- err
				return
			}
			var got struct{ N int }
			if err := json.Unmarshal(raw, &got); err != nil {
				errs <- err
				return
			}
			if got.N != i {
				errs <- errors.New("echo returned a mismatched payload")
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}
