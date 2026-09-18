// Package keepawake composes P87's two independent keep-awake reasons (the titlebar toggle and the
// agent-aware Settings leaf) onto one OS-level power assertion. Pure Go, no build tags, no cgo —
// internal/gitclient's own NewPlatformLocator is the house precedent for a runtime.GOOS switch that
// still compiles, vets and tests on every platform (docs/DEV_ENVIRONMENT.md's "darwin && cgo file
// is compiled, vetted and tested by nobody" note is exactly the reason not to reach for build tags
// here). Imports nothing from internal/bridge — internal/layering_test.go's
// TestDomainPackagesDoNotImportBridge covers this package automatically.
package keepawake

import "sync"

// Reason names one of the two independent, level-shaped sources that can hold the assertion
// (P87 §1.1) — never an edge: both are re-asserted freely by their own owner (a window re-toggling
// the same state, a settings/session-count recompute), so Controller composes them as a set, not a
// counter (§1.2).
type Reason string

const (
	// ReasonManual is the titlebar button's own on/off state — app-wide, process-scoped (§3.2).
	ReasonManual Reason = "manual"
	// ReasonAgent is claudeCode.keepAwakeWithAgents being on AND at least one Claude Code session
	// (P86's own tracked count) being live — recomputed wholesale on every input change, never an
	// edge of its own.
	ReasonAgent Reason = "agent"
)

// Controller composes N independent on/off reasons onto one OS-level assertion (§1): the driver's
// Acquire is called only on the empty→non-empty transition of the reason set, and Release only on
// non-empty→empty — every other Set call is a no-op by construction. A set, not a counter: a
// counter is correct only if every source's on/off calls are perfectly paired forever, and neither
// source here is (§1.2).
type Controller struct {
	mu      sync.Mutex
	driver  Driver
	reasons map[Reason]struct{}
	held    bool
	lastErr error
}

// lossReporter is an optional capability a Driver may implement when its assertion can be lost
// outside a Release call (the darwin driver's own caffeinate exiting on its own, §2.3) — kept off
// the public Driver interface since self-heal is Controller-internal machinery, not something every
// OS driver needs to know about (a noopDriver's assertion can never be lost).
type lossReporter interface {
	OnLost(func(error))
}

// New wires d into a fresh, unheld Controller. If d implements lossReporter, its callback is
// registered so an unrequested exit (§1.4) reaches reportLost.
func New(d Driver) *Controller {
	c := &Controller{driver: d, reasons: map[Reason]struct{}{}}
	if lr, ok := d.(lossReporter); ok {
		lr.OnLost(c.reportLost)
	}
	return c
}

// Set adds or removes r from the held reason set, then acquires or releases the underlying
// assertion only if that changes want (len(reasons) > 0) relative to the controller's own record of
// what is currently held — never merely whether this call changed the set's membership, so a
// self-heal (reportLost flipping held to false while reasons stays non-empty) is picked up by the
// very next Set for any reason, not only the one that changes (§1.4).
func (c *Controller) Set(r Reason, on bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if on {
		c.reasons[r] = struct{}{}
	} else {
		delete(c.reasons, r)
	}
	c.syncLocked()
}

// Rearm releases then re-acquires while held, and does nothing while idle (§1.4/§5) — a machine
// resume's own trigger: a live caffeinate process's assertion does not reliably survive a
// sleep/wake cycle, confirmed against Orca.
func (c *Controller) Rearm() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.held {
		return
	}
	c.releaseLocked()
	c.acquireLocked()
}

// Held reports whether the assertion is currently believed to be acquired.
func (c *Controller) Held() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.held
}

// Err returns the last acquire failure, nil once an acquire has succeeded.
func (c *Controller) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastErr
}

// Close releases the assertion unconditionally on app teardown, regardless of which reasons are
// still set — idempotent, safe to call when nothing is held.
func (c *Controller) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.held {
		c.releaseLocked()
	}
}

// syncLocked is Set's whole transition logic, factored out so reportLost can reuse it: recompute
// want against the current reason set and act only if it disagrees with held. mu must be held.
func (c *Controller) syncLocked() {
	want := len(c.reasons) > 0
	if want == c.held {
		return
	}
	if want {
		c.acquireLocked()
	} else {
		c.releaseLocked()
	}
}

// reportLost is a driver's reaper's own callback (§1.4/§2.3): the assertion process exited without
// a matching Release. No immediate respawn — held is simply corrected to false here; the next Set
// or Rearm recomputes want against it and re-acquires.
func (c *Controller) reportLost(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.held = false
	c.lastErr = err
}

// acquireLocked/releaseLocked perform the driver call inside the lock (§1.3: no two transitions can
// interleave, and no acquire can land after the release meant to follow it) — Acquire is a
// fork/exec and Release a Process.Kill(), both bounded; the driver's own Wait() happens in its
// reaper goroutine, never here, so the lock is never held across an unbounded wait.
func (c *Controller) acquireLocked() {
	if err := c.driver.Acquire(); err != nil {
		c.held = false
		c.lastErr = err
		return
	}
	c.held = true
	c.lastErr = nil
}

func (c *Controller) releaseLocked() {
	c.driver.Release()
	c.held = false
	c.lastErr = nil
}
