package enginebackend

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

type fakeSource struct {
	ch   chan enginehost.Event
	subs int
}

func (f *fakeSource) Subscribe() (<-chan enginehost.Event, func()) {
	f.subs++
	return f.ch, func() {}
}

func TestMerge_FansBothSourcesIntoOne(t *testing.T) {
	a := &fakeSource{ch: make(chan enginehost.Event, 4)}
	b := &fakeSource{ch: make(chan enginehost.Event, 4)}
	merged := Merge(a, b)

	out, unsubscribe := merged.Subscribe()
	defer unsubscribe()

	a.ch <- enginehost.Event{Topic: "op:start"}
	b.ch <- enginehost.Event{Topic: "op:end"}

	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		select {
		case evt := <-out:
			seen[evt.Topic] = true
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for a merged event")
		}
	}
	if !seen["op:start"] || !seen["op:end"] {
		t.Errorf("seen = %v, want both op:start and op:end", seen)
	}
}

// Merge's own fan-in goroutine must terminate once both underlying sources close their channels
// (e.g. the Node engine exits, or a test tears both down) — otherwise every Subscribe leaks one.
func TestMerge_TerminatesWhenBothSourcesClose(t *testing.T) {
	a := &fakeSource{ch: make(chan enginehost.Event)}
	b := &fakeSource{ch: make(chan enginehost.Event)}
	merged := Merge(a, b)

	out, unsubscribe := merged.Subscribe()
	defer unsubscribe()

	close(a.ch)
	close(b.ch)

	select {
	case _, ok := <-out:
		if ok {
			t.Fatal("expected the merged channel to close, got a value instead")
		}
	case <-time.After(time.Second):
		t.Fatal("merged channel never closed")
	}
}
