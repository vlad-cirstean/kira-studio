package gitsession

import (
	"context"
	"sync"
)

// opSlot is the shared "≤1 op in flight" box remote.go (remoteOpSlot), stack.go (restackSlot) and
// worktree.go (prepareOpSlot) each rebuilt identically: a mutex-guarded claim/release/tryCancel/
// forceCancel around one context.CancelFunc. remoteOpSlot was the superset — a kind label plus a
// killable toggle that flips per phase (D19), since a remote op has phases whose outcome is
// unknowable the way a half-delivered push is. restack (D6/D9) and prepare (D13) have no such
// phase — both are ALWAYS cancellable the instant they claim — so they use claimAlways instead of
// remote.run's claim+later setKillable(true) sequence, and never call setKillable themselves.
type opSlot struct {
	mu       sync.Mutex
	kind     string // "" when idle
	killable bool   // flips per phase (D19); claimAlways sets this true immediately
	cancel   context.CancelFunc
}

// claim reserves the slot not-yet-killable — remote.run's own path (D19): a later
// setKillable(true) call makes it cancellable once the current phase allows it.
func (s *opSlot) claim(kind string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind != "" {
		return false
	}
	s.kind, s.killable, s.cancel = kind, false, cancel
	return true
}

// claimAlways reserves the slot already killable — restack.run and worktree.prepare's own path:
// no phase of either is unknowable the way a half-delivered push is, so both are cancellable from
// the moment they claim.
func (s *opSlot) claimAlways(kind string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind != "" {
		return false
	}
	s.kind, s.killable, s.cancel = kind, true, cancel
	return true
}

func (s *opSlot) setKillable(v bool) {
	s.mu.Lock()
	s.killable = v
	s.mu.Unlock()
}

func (s *opSlot) release() {
	s.mu.Lock()
	s.kind, s.killable, s.cancel = "", false, nil
	s.mu.Unlock()
}

// tryCancel is a cancel executor's own entry point: false — NEVER an error — when nothing is
// running or the current phase is not killable; a cancel racing a just-finished op is an ordinary
// outcome, not a fault.
func (s *opSlot) tryCancel() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind == "" || !s.killable {
		return false
	}
	s.cancel()
	return true
}

// forceCancel is teardown's own unconditional cancel — the entry itself is going away, so any
// in-flight op's context is cancelled regardless of its killable flag.
func (s *opSlot) forceCancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
}
