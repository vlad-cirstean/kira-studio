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

func TestDataFrameReachesSinkByteIdentical(t *testing.T) {
	h := newHost(t, fixture)
	sink := &fakeSink{}
	detach := h.AttachStream(sink)
	defer detach()

	big := bytes.Repeat([]byte("x"), 1<<20+37) // > 1 MiB, an odd size on purpose
	sendDataRequest(t, h, 1, "echo", map[string]any{"blob": string(big)})

	waitFor(t, 5*time.Second, func() bool { return len(sink.received()) == 1 })
	var resp struct {
		Payload struct {
			Blob string `json:"blob"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(sink.received()[0], &resp); err != nil {
		t.Fatalf("unmarshal sink frame: %v", err)
	}
	if resp.Payload.Blob != string(big) {
		t.Errorf("echoed blob length %d != sent length %d, or content mismatch", len(resp.Payload.Blob), len(big))
	}
}

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

func TestControlAndDataDemux(t *testing.T) {
	h := newHost(t, fixture)
	sink := &fakeSink{}
	detach := h.AttachStream(sink)
	defer detach()

	sendDataRequest(t, h, 1, "echo", map[string]any{"marker": "data-channel"})
	raw, err := h.Call("ping", nil)
	if err != nil {
		t.Fatalf("Call(ping): %v", err)
	}
	var pong struct{ Pong bool }
	if err := json.Unmarshal(raw, &pong); err != nil || !pong.Pong {
		t.Fatalf("Call(ping) response = %s", raw)
	}

	waitFor(t, 5*time.Second, func() bool { return len(sink.received()) == 1 })
	if !bytes.Contains(sink.received()[0], []byte("data-channel")) {
		t.Errorf("sink frame = %s, want it to contain the data-channel request's marker", sink.received()[0])
	}
}

func TestNoSinkDropsDataFrames(t *testing.T) {
	h := newHost(t, fixture)
	for i := 0; i < 200; i++ {
		sendDataRequest(t, h, i, "echo", map[string]any{"i": i})
	}
	if _, err := h.Call("ping", nil); err != nil {
		t.Errorf("Call(ping) after 200 unattached data frames: %v", err)
	}
}

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

func TestSendRetriesOnStreamFull(t *testing.T) {
	h := newHost(t, fixture)
	sink := &fakeSink{full: 5}
	detach := h.AttachStream(sink)
	defer detach()

	start := time.Now()
	sendDataRequest(t, h, 1, "echo", map[string]any{"ok": true})
	waitFor(t, 5*time.Second, func() bool { return len(sink.received()) == 1 })
	elapsed := time.Since(start)

	if elapsed < 2*time.Millisecond {
		t.Errorf("delivery took %s, want at least the backoff floor (5 retries)", elapsed)
	}
	if got := sink.received(); len(got) != 1 {
		t.Fatalf("sink received %d frames, want exactly 1 (no duplicate delivery)", len(got))
	}
}

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
