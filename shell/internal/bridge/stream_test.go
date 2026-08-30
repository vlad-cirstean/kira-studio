package bridge_test

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/enginetest"
)

// fakeSession implements bridge.StreamSession. Receive drains a channel of frames the test feeds
// it; Send records every frame delivered to it, optionally gated by a release channel to exercise
// backpressure.
type fakeSession struct {
	toEngine chan []byte // fed to Receive
	closed   chan struct{}

	mu      sync.Mutex
	sent    [][]byte
	release chan struct{} // if non-nil, Send blocks until this is closed
}

func newFakeSession() *fakeSession {
	return &fakeSession{toEngine: make(chan []byte, 16), closed: make(chan struct{})}
}

func (f *fakeSession) Receive() ([]byte, error) {
	select {
	case frame, ok := <-f.toEngine:
		if !ok {
			return nil, errClosedSession
		}
		return frame, nil
	case <-f.closed:
		return nil, errClosedSession
	}
}

func (f *fakeSession) Send(frame []byte) error {
	if f.release != nil {
		<-f.release
	}
	f.mu.Lock()
	f.sent = append(f.sent, append([]byte(nil), frame...))
	f.mu.Unlock()
	return nil
}

func (f *fakeSession) sentFrames() [][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]byte(nil), f.sent...)
}

func (f *fakeSession) close() {
	close(f.closed)
}

var errClosedSession = errClosedSessionError{}

type errClosedSessionError struct{}

func (errClosedSessionError) Error() string { return "fake session closed" }

func waitUntilBridge(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

func TestFramePassthroughIntegrity(t *testing.T) {
	host := enginetest.Host(t)
	session := newFakeSession()
	go bridge.ServeEngineStream(host, session)

	payload := make([]byte, 1<<20) // 1 MiB
	for i := range payload {
		payload[i] = byte(i)
	}
	session.toEngine <- payload

	waitUntilBridge(t, 2*time.Second, func() bool { return len(session.sentFrames()) >= 1 })
	got := session.sentFrames()[0]
	if !bytes.Equal(got, payload) {
		t.Fatalf("echoed frame differs from what was sent (len got=%d want=%d)", len(got), len(payload))
	}
}

func TestDemuxByTag(t *testing.T) {
	host := enginetest.Host(t)
	session := newFakeSession()
	go bridge.ServeEngineStream(host, session)

	events, unsubscribe := host.Subscribe()
	defer unsubscribe()

	// Control-tag: ask the fixture to emit an op:start event.
	if _, err := host.Call("fixture:emit-op-start", map[string]any{"opId": "op1"}); err != nil {
		t.Fatalf("fixture:emit-op-start: %v", err)
	}
	select {
	case evt := <-events:
		if evt.Topic != "op:start" {
			t.Fatalf("event topic = %q, want op:start", evt.Topic)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the control-tag event")
	}
	if len(session.sentFrames()) != 0 {
		t.Errorf("control-tag traffic reached the stream session: %d frames", len(session.sentFrames()))
	}

	// Data-tag: echo-data must reach the session, not the control-channel subscriber.
	session.toEngine <- []byte("data-tag payload")
	waitUntilBridge(t, 2*time.Second, func() bool { return len(session.sentFrames()) >= 1 })
	if string(session.sentFrames()[0]) != "data-tag payload" {
		t.Errorf("session received %q, want the data-tag payload", session.sentFrames()[0])
	}
}

func TestSessionCloseDetaches(t *testing.T) {
	host := enginetest.Host(t)
	session := newFakeSession()
	done := make(chan struct{})
	go func() {
		bridge.ServeEngineStream(host, session)
		close(done)
	}()

	session.close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("ServeEngineStream did not return after Receive failed")
	}

	// A later SendData must neither panic nor block now that no sink is attached.
	doneSend := make(chan error, 1)
	go func() { doneSend <- host.SendData([]byte("late frame")) }()
	select {
	case err := <-doneSend:
		if err != nil {
			t.Errorf("SendData after detach returned %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SendData blocked after the session detached")
	}
}

func TestSupersededSessionStopsReceiving(t *testing.T) {
	// This is purely about AttachStream's own generation-counter supersede behaviour (P54), which
	// bridge.StreamSession satisfies structurally — attaching directly, synchronously, in a known
	// order avoids any race over which of two concurrent ServeEngineStream goroutines attaches
	// last.
	host := enginetest.Host(t)
	first := newFakeSession()
	second := newFakeSession()

	detachFirst := host.AttachStream(first)
	defer detachFirst()
	detachSecond := host.AttachStream(second)
	defer detachSecond()

	// SendData round-trips through the fixture's data-tag echo (D13); only the current sink
	// (second) should receive the answer.
	if err := host.SendData([]byte("after supersede")); err != nil {
		t.Fatalf("SendData: %v", err)
	}
	waitUntilBridge(t, 2*time.Second, func() bool { return len(second.sentFrames()) >= 1 })
	if len(first.sentFrames()) != 0 {
		t.Errorf("the superseded first session received %d frames, want 0", len(first.sentFrames()))
	}
}

func TestEngineDownKeepsSessionOpen(t *testing.T) {
	host := enginetest.Host(t)
	session := newFakeSession()
	done := make(chan struct{})
	go func() {
		bridge.ServeEngineStream(host, session)
		close(done)
	}()

	_, _ = host.Call("fixture:crash", nil) // never answers; the engine process exits instead
	time.Sleep(100 * time.Millisecond)

	select {
	case <-done:
		t.Fatal("ServeEngineStream returned after the engine went down, want it to stay in Receive")
	default:
	}
	session.close()
	<-done
}

func TestBackpressureAtTheBoundedChannel(t *testing.T) {
	host := enginetest.Host(t)
	session := newFakeSession()
	release := make(chan struct{})
	session.release = release
	go bridge.ServeEngineStream(host, session)

	// Comfortably more than enginehost's own 64-frame queue bound (stream.go's dataQueueFrames):
	// with session.Send blocked, the echoed frames from the fixture back up in that queue, then
	// in the OS pipes on both sides of the engine child, all before any of them ever reaches
	// session.Send.
	const n = 200
	frames := make([][]byte, n)
	for i := range frames {
		payload, _ := json.Marshal(map[string]any{"i": i})
		frames[i] = payload
	}

	sendDone := make(chan error, 1)
	go func() {
		for _, f := range frames {
			if err := host.SendData(f); err != nil {
				sendDone <- err
				return
			}
		}
		sendDone <- nil
	}()

	close(release)
	select {
	case err := <-sendDone:
		if err != nil {
			t.Fatalf("SendData: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SendData never finished after release")
	}

	waitUntilBridge(t, 5*time.Second, func() bool { return len(session.sentFrames()) == n })
	got := session.sentFrames()
	for i, frame := range got {
		if !bytes.Equal(frame, frames[i]) {
			t.Errorf("frame[%d] = %q, want %q (order must be preserved, nothing dropped)", i, frame, frames[i])
		}
	}
}
