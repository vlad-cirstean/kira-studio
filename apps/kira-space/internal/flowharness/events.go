package flowharness

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// Event is one emit the app made toward a window.
type Event struct {
	Seq     int
	Channel string
	// Window is the target key of an EmitTo; empty for Emit and EmitFocused.
	Window  string
	Focused bool
	Data    any
}

// Decode re-marshals the payload into out, the way the renderer sees it.
func (e Event) Decode(t testing.TB, out any) {
	t.Helper()
	raw, err := json.Marshal(e.Data)
	if err != nil {
		t.Fatalf("event %s: marshal: %v", e.Channel, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("event %s: unmarshal %s: %v", e.Channel, raw, err)
	}
}

// Events records every emit and implements appevent.Emitter.
type Events struct {
	mu     sync.Mutex
	list   []Event
	notify chan struct{}
}

func newEvents() *Events { return &Events{notify: make(chan struct{})} }

func (e *Events) add(ev Event) {
	e.mu.Lock()
	ev.Seq = len(e.list)
	e.list = append(e.list, ev)
	old := e.notify
	e.notify = make(chan struct{})
	e.mu.Unlock()
	close(old)
}

func (e *Events) Emit(name string, data any) { e.add(Event{Channel: name, Data: data}) }

func (e *Events) EmitTo(windowKey, name string, data any) {
	e.add(Event{Channel: name, Window: windowKey, Data: data})
}

func (e *Events) EmitFocused(name string, data any) {
	e.add(Event{Channel: name, Focused: true, Data: data})
}

// Mark returns a cursor for Since and WaitAfter.
func (e *Events) Mark() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.list)
}

// Since returns the events on channel recorded at or after mark; channel "" matches all.
func (e *Events) Since(mark int, channel string) []Event {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []Event
	for _, ev := range e.list[min(mark, len(e.list)):] {
		if channel == "" || ev.Channel == channel {
			out = append(out, ev)
		}
	}
	return out
}

// Wait blocks until an event on channel satisfies pred (nil matches any), counting events already
// recorded. It fails the test on timeout.
func (e *Events) Wait(t testing.TB, channel string, pred func(Event) bool, timeout time.Duration) Event {
	t.Helper()
	return e.WaitAfter(t, 0, channel, pred, timeout)
}

// WaitAfter is Wait over events recorded at or after mark.
func (e *Events) WaitAfter(t testing.TB, mark int, channel string, pred func(Event) bool, timeout time.Duration) Event {
	t.Helper()
	deadline := time.After(timeout)
	for {
		e.mu.Lock()
		for _, ev := range e.list[min(mark, len(e.list)):] {
			if ev.Channel == channel && (pred == nil || pred(ev)) {
				e.mu.Unlock()
				return ev
			}
		}
		wake := e.notify
		e.mu.Unlock()
		select {
		case <-wake:
		case <-deadline:
			t.Fatalf("no %q event within %s", channel, timeout)
			return Event{}
		}
	}
}
