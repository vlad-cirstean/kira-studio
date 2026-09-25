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

// claim reserves the slot (P113 G13). killable is remote.run's own false — a later setKillable(true)
// call makes it cancellable once the current phase allows it (D19: a half-delivered push has phases
// whose outcome is unknowable) — or restack.run/worktree.prepare's own true: neither has such a
// phase, so both are cancellable from the moment they claim, and neither ever calls setKillable
// itself.
func (s *opSlot) claim(kind string, cancel context.CancelFunc, killable bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.kind != "" {
		return false
	}
	s.kind, s.killable, s.cancel = kind, killable, cancel
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
