package keepawake

import (
	"errors"
	"sync"
	"testing"
)

// fakeDriver asserts its own invariant — it fails the test on Acquire while already acquired, or
// Release while not — so every case below checks double-acquire and premature-release for free
// (P87 plan §10.1). t.Errorf is used rather than Fatalf/FailNow: the concurrent test drives this
// from goroutines other than the test's own, and only Errorf is safe to call from those.
type fakeDriver struct {
	t *testing.T

	mu       sync.Mutex
	acquired bool
	acquires int
	releases int
	onLost   func(error)
}

func newFakeDriver(t *testing.T) *fakeDriver {
	return &fakeDriver{t: t}
}

func (f *fakeDriver) Acquire() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.acquired {
		f.t.Errorf("fakeDriver: Acquire called while already acquired")
	}
	f.acquired = true
	f.acquires++
	return nil
}

func (f *fakeDriver) Release() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.acquired {
		f.t.Errorf("fakeDriver: Release called while not acquired")
	}
	f.acquired = false
	f.releases++
}

func (f *fakeDriver) Supported() bool { return true }

func (f *fakeDriver) OnLost(cb func(error)) {
	f.mu.Lock()
	f.onLost = cb
	f.mu.Unlock()
}

// simulateLoss stands in for caffeinate.go's reaper goroutine (§2.3) calling back into the
// controller after the underlying process exited on its own — fakeDriver has no real child to
// reap, so the test drives the same callback directly.
func (f *fakeDriver) simulateLoss(err error) {
	f.mu.Lock()
	f.acquired = false
	cb := f.onLost
	f.mu.Unlock()
	if cb != nil {
		cb(err)
	}
}

func (f *fakeDriver) counts() (acquires, releases int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acquires, f.releases
}

func TestControllerManualOn(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	if acq, rel := d.counts(); acq != 1 || rel != 0 {
		t.Fatalf("acquires=%d releases=%d, want 1/0", acq, rel)
	}
	if !c.Held() {
		t.Fatal("Held() = false, want true")
	}
}

func TestControllerManualOnOnOnStaysAtOneAcquire(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	c.Set(ReasonManual, true)
	c.Set(ReasonManual, true)
	if acq, rel := d.counts(); acq != 1 || rel != 0 {
		t.Fatalf("acquires=%d releases=%d, want 1/0", acq, rel)
	}
}

// TestControllerPrematureReleaseCase is SPEC's own named case: two reasons hold the assertion, one
// releases, the other still holds it — the release must not fire early.
func TestControllerPrematureReleaseCase(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	c.Set(ReasonAgent, true)
	c.Set(ReasonManual, false)
	if acq, rel := d.counts(); acq != 1 || rel != 0 {
		t.Fatalf("acquires=%d releases=%d, want 1/0 (premature release)", acq, rel)
	}
	if !c.Held() {
		t.Fatal("Held() = false, want true — agent reason still set")
	}
}

func TestControllerBothOffReleasesExactlyOnce(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	c.Set(ReasonAgent, true)
	c.Set(ReasonManual, false)
	c.Set(ReasonAgent, false)
	if acq, rel := d.counts(); acq != 1 || rel != 1 {
		t.Fatalf("acquires=%d releases=%d, want 1/1", acq, rel)
	}
	if c.Held() {
		t.Fatal("Held() = true, want false")
	}
}

func TestControllerAgentOnOffOn(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonAgent, true)
	c.Set(ReasonAgent, false)
	c.Set(ReasonAgent, true)
	if acq, rel := d.counts(); acq != 2 || rel != 1 {
		t.Fatalf("acquires=%d releases=%d, want 2/1", acq, rel)
	}
}

func TestControllerRearmWhileHeld(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	c.Rearm()
	if acq, rel := d.counts(); acq != 2 || rel != 1 {
		t.Fatalf("acquires=%d releases=%d, want 2/1 (release then acquire)", acq, rel)
	}
	if !c.Held() {
		t.Fatal("Held() = false after Rearm, want true")
	}
}

func TestControllerRearmWhileIdleIsANoop(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Rearm()
	if acq, rel := d.counts(); acq != 0 || rel != 0 {
		t.Fatalf("acquires=%d releases=%d, want 0/0", acq, rel)
	}
}

// TestControllerSelfHealsAfterUnexpectedExit covers §1.4: the driver reports an exit it did not
// expect, and the very next Set (for any reason, not necessarily the one that changed) re-acquires
// rather than requiring the caller to notice and retry itself.
func TestControllerSelfHealsAfterUnexpectedExit(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)
	c.Set(ReasonManual, true)
	if acq, _ := d.counts(); acq != 1 {
		t.Fatalf("acquires=%d, want 1", acq)
	}

	d.simulateLoss(errors.New("caffeinate exited"))
	if c.Held() {
		t.Fatal("Held() = true after simulateLoss, want false")
	}
	if got := c.Err(); got == nil {
		t.Fatal("Err() = nil after simulateLoss, want the reported error")
	}

	// The reason set itself is unchanged (manual is still "on") — this call's own membership write
	// is a no-op, and re-acquiring still has to come from recomputing against the now-false held.
	c.Set(ReasonManual, true)
	if acq, _ := d.counts(); acq != 2 {
		t.Fatalf("acquires=%d after self-heal Set, want 2", acq)
	}
	if !c.Held() {
		t.Fatal("Held() = false after self-heal Set, want true")
	}
}

// TestControllerConcurrentReasonsRace drives both reasons from separate goroutines under -race: the
// fake's own double-acquire/premature-release invariant never trips (Controller.mu serialises every
// driver call, §1.3), and the set ends up empty with nothing held.
func TestControllerConcurrentReasonsRace(t *testing.T) {
	d := newFakeDriver(t)
	c := New(d)

	const iterations = 200
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			c.Set(ReasonManual, true)
			c.Set(ReasonManual, false)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			c.Set(ReasonAgent, true)
			c.Set(ReasonAgent, false)
		}
	}()
	wg.Wait()

	// Both goroutines leave their own reason off, but interleaving means the final Set(..., false)
	// pair may not be the very last driver call in flight — settle explicitly before asserting.
	c.Set(ReasonManual, false)
	c.Set(ReasonAgent, false)

	if c.Held() {
		t.Fatal("Held() = true after both reasons settled off, want false")
	}
	acq, rel := d.counts()
	if acq != rel {
		t.Fatalf("acquires=%d releases=%d, want equal (nothing leaked or double-released)", acq, rel)
	}
}
