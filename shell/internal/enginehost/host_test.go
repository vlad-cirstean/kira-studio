package enginehost_test

import (
	"encoding/json"
	"errors"
	"strings"
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

func TestCallPingRoundTrip(t *testing.T) {
	h := newHost(t, fixture)
	raw, err := h.Call("ping", nil)
	if err != nil {
		t.Fatalf("Call(ping): %v", err)
	}
	var payload struct {
		Pong      bool `json:"pong"`
		EnginePID int  `json:"enginePid"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if !payload.Pong {
		t.Error("payload.pong = false, want true")
	}
	if payload.EnginePID != h.PID() {
		t.Errorf("payload.enginePid = %d, want %d", payload.EnginePID, h.PID())
	}
}

func TestCallSurfacesStructuredError(t *testing.T) {
	h := newHost(t, fixture)

	_, err := h.Call("boom", nil)
	ie := asIpcErr(t, err)
	if ie.Code != "E_SPIKE" || ie.Message != "synthetic failure" {
		t.Errorf("boom -> %+v, want {E_SPIKE synthetic failure}", ie)
	}
	if strings.Contains(ie.Error(), "[") {
		t.Errorf("Error() = %q, must not contain the retired [CODE] prefix folding", ie.Error())
	}
	var roundTrip map[string]string
	if err := json.Unmarshal([]byte(ie.Error()), &roundTrip); err != nil {
		t.Fatalf("Error() is not the {code,message} JSON encoding: %v", err)
	}

	_, err = h.Call("bare", nil)
	ie = asIpcErr(t, err)
	if ie.Code != "E_QUERY" || ie.Message != "no code here" {
		t.Errorf("bare -> %+v, want {E_QUERY \"no code here\"}", ie)
	}
}

func TestCallTimeout(t *testing.T) {
	h := newHost(t, fixture)
	_, err := h.CallTimeout("slow", nil, 100*time.Millisecond)
	ie := asIpcErr(t, err)
	if ie.Code != "E_TIMEOUT" {
		t.Errorf("Code = %q, want E_TIMEOUT", ie.Code)
	}
	if !strings.Contains(ie.Message, `"slow"`) || !strings.Contains(ie.Message, "timed out") {
		t.Errorf("Message = %q, want it to name the op and say timed out", ie.Message)
	}

	// The pending entry must have been cleaned up — a later call still gets its own response.
	if _, err := h.Call("ping", nil); err != nil {
		t.Errorf("ping after a timeout: %v", err)
	}
}

func TestTimeoutConstants(t *testing.T) {
	if enginehost.DefaultTimeout != 30*time.Second {
		t.Errorf("DefaultTimeout = %s, want 30s (engine-host.ts:6)", enginehost.DefaultTimeout)
	}
	if enginehost.ConnectTimeout != 20*time.Second {
		t.Errorf("ConnectTimeout = %s, want 20s (connections.ts:191/345)", enginehost.ConnectTimeout)
	}
}

func TestCallOnStoppedHostFailsFast(t *testing.T) {
	h := newHost(t, fixture)
	h.Stop()

	start := time.Now()
	_, err := h.Call("ping", nil)
	elapsed := time.Since(start)

	ie := asIpcErr(t, err)
	if ie.Code != "E_ENGINE_DOWN" {
		t.Errorf("Code = %q, want E_ENGINE_DOWN", ie.Code)
	}
	if elapsed > time.Second {
		t.Errorf("Call on a stopped host took %s, want well under the 30s default timeout", elapsed)
	}
}

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

func TestEventFanOutReachesEverySubscriber(t *testing.T) {
	h := newHost(t, fixture)
	ch1, unsub1 := h.Subscribe()
	defer unsub1()
	ch2, unsub2 := h.Subscribe()
	defer unsub2()

	if _, err := h.Call("evt", map[string]any{"topic": "my-topic", "payload": map[string]any{"x": 1}}); err != nil {
		t.Fatalf("Call(evt): %v", err)
	}

	for i, ch := range []<-chan enginehost.Event{ch1, ch2} {
		select {
		case evt := <-ch:
			if evt.Topic != "my-topic" {
				t.Errorf("subscriber %d topic = %q, want my-topic", i, evt.Topic)
			}
			var payload struct{ X int }
			if err := json.Unmarshal(evt.Payload, &payload); err != nil || payload.X != 1 {
				t.Errorf("subscriber %d payload = %s, want {x:1}", i, evt.Payload)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("subscriber %d never received the event", i)
		}
	}
}

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

func TestStderrIsLoggedLineWise(t *testing.T) {
	logs := captureLogs(t)
	h := newHost(t, fixture)
	if _, err := h.Call("logline", nil); err != nil {
		t.Fatalf("Call(logline): %v", err)
	}
	// Give the async stderr pump a moment to catch up with the already-answered call.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s := logs.String()
		if strings.Contains(s, "fixture stderr line one") && strings.Contains(s, "fixture stderr line two") {
			if !strings.Contains(s, "scope=engine") {
				t.Errorf("stderr log lines missing scope=engine: %s", s)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("stderr lines not observed in logs: %s", logs.String())
}

func TestExitCodeIsLogged(t *testing.T) {
	logs := captureLogs(t)
	h := newHost(t, fixture)
	_, _ = h.Call("crash", nil)
	<-h.Down()
	if !strings.Contains(logs.String(), "scope=engine-host") {
		t.Errorf("exit was not logged under scope=engine-host: %s", logs.String())
	}
}

func TestUnknownTagDoesNotDesync(t *testing.T) {
	h := newHost(t, fixture)
	if _, err := h.Call("badtag", nil); err != nil {
		t.Fatalf("Call(badtag): %v", err)
	}
	// The garbage tag-7 frame must not have desynchronised the reader.
	if _, err := h.Call("ping", nil); err != nil {
		t.Errorf("ping after badtag: %v", err)
	}
}

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
