package enginehost_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// fakeSink is a Sink test double: it can fail the first `full` sends with ErrStreamFull, then
// either succeed or return a fixed non-full error, and can be made to block on demand so a test
// can observe backpressure before releasing it.
type fakeSink struct {
	mu     sync.Mutex
	frames [][]byte
	full   int
	calls  int
	err    error
	block  <-chan struct{}
}

func (s *fakeSink) Send(frame []byte) error {
	if s.block != nil {
		<-s.block
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.calls <= s.full {
		return enginehost.ErrStreamFull
	}
	if s.err != nil {
		return s.err
	}
	cp := append([]byte(nil), frame...)
	s.frames = append(s.frames, cp)
	return nil
}

func (s *fakeSink) received() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([][]byte, len(s.frames))
	copy(out, s.frames)
	return out
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", timeout)
}

func sendDataRequest(t *testing.T, h *enginehost.Host, id int, op string, payload any) {
	t.Helper()
	req := map[string]any{"kind": "req", "id": id, "op": op, "payload": payload}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if err := h.SendData(body); err != nil {
		t.Fatalf("SendData: %v", err)
	}
}

// TestDataFrameIsNotUnmarshalled pins the data channel's opaque-bytes contract: Go must hand a
// tag-1 frame to the Sink byte for byte, never parsing or re-encoding it — proven with a payload
// that is not valid JSON or UTF-8 at all.
func TestDataFrameIsNotUnmarshalled(t *testing.T) {
	h := newHost(t, fixture)
	sink := &fakeSink{}
	detach := h.AttachStream(sink)
	defer detach()

	notJSON := []byte("\x00\xffnot json at all")
	sendDataRequest(t, h, 1, "raw", map[string]any{"bytesBase64": base64.StdEncoding.EncodeToString(notJSON)})

	waitFor(t, 5*time.Second, func() bool { return len(sink.received()) == 1 })
	if !bytes.Equal(sink.received()[0], notJSON) {
		t.Errorf("sink frame = %q, want the literal non-JSON bytes %q", sink.received()[0], notJSON)
	}
}

// TestBackpressureStallsThenRecovers covers the whole backpressure chain: a blocked sink fills
// the bounded queue, the read loop stops draining stdout and the OS pipe pushes back on the
// engine — and once released, all 500 frames arrive intact and in order.
func TestBackpressureStallsThenRecovers(t *testing.T) {
	h := newHost(t, fixture)
	block := make(chan struct{})
	sink := &fakeSink{block: block}
	detach := h.AttachStream(sink)
	defer detach()

	floodDone := make(chan error, 1)
	go func() {
		_, err := h.CallTimeout("flood", map[string]any{"count": 500, "size": 2048}, 10*time.Second)
		floodDone <- err
	}()

	select {
	case <-floodDone:
		t.Fatal("flood completed before the blocked sink was released — backpressure did not reach the engine")
	case <-time.After(500 * time.Millisecond):
	}

	close(block)
	select {
	case err := <-floodDone:
		if err != nil {
			t.Fatalf("flood call: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("flood never completed after releasing the sink")
	}
	waitFor(t, 5*time.Second, func() bool { return len(sink.received()) == 500 })

	for i, frame := range sink.received() {
		want := byte(i % 256)
		if len(frame) != 2048 || frame[0] != want {
			t.Fatalf("frame %d malformed or out of order (first byte %d, want %d)", i, frame[0], want)
		}
	}
}

// TestNonFullSinkErrorDetaches pins deliver's two-way error discrimination: ErrStreamFull means
// retry, anything else means the session is gone and the sink must be detached. Getting this
// backwards makes the writer goroutine spin forever against a dead session.
func TestNonFullSinkErrorDetaches(t *testing.T) {
	h := newHost(t, fixture)
	sink := &fakeSink{err: errors.New("session gone")}
	detach := h.AttachStream(sink)
	defer detach()

	sendDataRequest(t, h, 1, "echo", map[string]any{"n": 1})
	waitFor(t, 5*time.Second, func() bool {
		sink.mu.Lock()
		defer sink.mu.Unlock()
		return sink.calls == 1
	})

	sendDataRequest(t, h, 2, "echo", map[string]any{"n": 2})
	time.Sleep(200 * time.Millisecond) // give a wrongly-still-attached sink a chance to be called again
	sink.mu.Lock()
	calls := sink.calls
	sink.mu.Unlock()
	if calls != 1 {
		t.Errorf("sink.calls = %d after a non-full error, want 1 (detached, not retried)", calls)
	}

	if _, err := h.Call("ping", nil); err != nil {
		t.Errorf("Call(ping) after sink detach: %v", err)
	}
}

// TestSupersededSinkAbandonsRetry covers the sink generation counter: a frame mid-retry against a
// sink that has since been replaced belongs to a dead session and must be abandoned, never
// delivered late to the sink that replaced it.
func TestSupersededSinkAbandonsRetry(t *testing.T) {
	h := newHost(t, fixture)
	sinkA := &fakeSink{full: 1 << 30} // effectively always ErrStreamFull
	detachA := h.AttachStream(sinkA)

	sendDataRequest(t, h, 1, "echo", map[string]any{"which": "A"})
	time.Sleep(50 * time.Millisecond) // let the retry loop start spinning against sinkA

	sinkB := &fakeSink{}
	detachB := h.AttachStream(sinkB)
	defer detachB()
	defer detachA()

	sendDataRequest(t, h, 2, "echo", map[string]any{"which": "B"})
	waitFor(t, 5*time.Second, func() bool { return len(sinkB.received()) == 1 })

	if len(sinkA.received()) != 0 {
		t.Errorf("sinkA received %d frames, want 0 (its in-flight frame should be abandoned, not delivered late)", len(sinkA.received()))
	}
	if !bytes.Contains(sinkB.received()[0], []byte(`"which":"B"`)) {
		t.Errorf("sinkB frame = %s, want the B request", sinkB.received()[0])
	}
}
