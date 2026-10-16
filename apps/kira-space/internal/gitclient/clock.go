package gitclient

import "time"

// Clock is D2's time seam — declared alongside Runner and Watcher from this package's first
// commit, per the same reasoning: a TTL-gated cache (discovery.go's re-probe interval) is
// unit-testable against a fake clock that jumps forward on command, never against a real one a
// test would have to sleep through.
type Clock interface {
	Now() time.Time
}

// realClock is the one real Clock: time.Now(), nothing else.
type realClock struct{}

// NewRealClock returns the real, wall-clock-backed Clock.
func NewRealClock() Clock { return realClock{} }

func (realClock) Now() time.Time { return time.Now() }
