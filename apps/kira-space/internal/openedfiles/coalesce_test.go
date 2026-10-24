package openedfiles

import (
	"slices"
	"testing"
	"time"
)

// fakeClock fires only the latest scheduled call, on demand.
type fakeClock struct {
	fn      func()
	stopped bool
}

func (c *fakeClock) after(_ time.Duration, f func()) Stop {
	c.fn, c.stopped = f, false
	return func() { c.stopped = true }
}

func (c *fakeClock) fire() {
	if c.fn != nil && !c.stopped {
		c.fn()
	}
}

func TestCoalescer(t *testing.T) {
	clock := &fakeClock{}
	var batches [][]string
	co := NewCoalescer(time.Second, clock.after, func(p []string) { batches = append(batches, p) })

	co.Add("a")
	co.Add("b")
	// An earlier timer that survives a later Add must not flush.
	stale := clock.fn
	co.Add("c")
	stale()
	if len(batches) != 0 {
		t.Fatalf("stale timer flushed: %v", batches)
	}
	clock.fire()
	if len(batches) != 1 || !slices.Equal(batches[0], []string{"a", "b", "c"}) {
		t.Fatalf("batches = %v, want one [a b c]", batches)
	}

	co.Add("d")
	clock.fire()
	if len(batches) != 2 || !slices.Equal(batches[1], []string{"d"}) {
		t.Fatalf("batches = %v, want second [d]", batches)
	}

	co.Add("e")
	co.Close()
	clock.fire()
	co.Add("f")
	clock.fire()
	if len(batches) != 2 {
		t.Fatalf("Close did not drop: %v", batches)
	}
}
