package scriptruns

import (
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/flowtest/fakeclock"
	"github.com/kirathecat/kira-studio/internal/scripts"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestNextFiresDST(t *testing.T) {
	ny := mustLoc(t, "America/New_York")
	// 2026-03-08 has no 02:30 in New York: the day is skipped, not moved to 03:30.
	got, err := scripts.NextFires("30 2 * * *", "America/New_York", time.Date(2026, 3, 7, 12, 0, 0, 0, ny), 3)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range got {
		if g.In(ny).Format("15:04") != "02:30" || g.In(ny).Day() == 8 {
			t.Errorf("fire %v: want 02:30 and never March 8", g)
		}
	}
	// 2026-11-01 01:30 happens twice: it fires once.
	got, err = scripts.NextFires("30 1 * * *", "America/New_York", time.Date(2026, 10, 31, 12, 0, 0, 0, ny), 3)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].In(ny).Day() != 1 || got[1].In(ny).Day() != 2 {
		t.Errorf("fires %v: want one on Nov 1, then Nov 2", got)
	}
	// Every minute fires once per wall minute: the repeated 01:00-01:59 hour is 60 fires, not 120.
	at, rep := time.Date(2026, 11, 1, 0, 59, 0, 0, ny), 0
	for {
		next, err := scripts.NextFires("* * * * *", "America/New_York", at, 10)
		if err != nil {
			t.Fatal(err)
		}
		at = next[len(next)-1]
		for _, n := range next {
			if n.In(ny).Hour() == 1 {
				rep++
			}
		}
		if at.In(ny).Hour() >= 2 {
			break
		}
	}
	if rep != 60 {
		t.Errorf("fires in the repeated hour = %d, want 60", rep)
	}
	// 96 quarter hours in a UTC day.
	count, at := 0, time.Date(2026, 5, 31, 23, 59, 0, 0, time.UTC)
	for at.Month() == time.May || at.Day() == 1 {
		next, err := scripts.NextFires("*/15 * * * *", "UTC", at, 10)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range next {
			if n.Month() == time.June && n.Day() == 1 {
				count++
			}
		}
		at = next[len(next)-1]
	}
	if count != 96 {
		t.Errorf("quarter hours in the day = %d, want 96", count)
	}
	// Monday only: 2026-10-10 is a Saturday.
	got, _ = scripts.NextFires("0 9 * * 1", "UTC", time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC), 2)
	if got[0].Weekday() != time.Monday || got[1].Sub(got[0]) != 7*24*time.Hour {
		t.Errorf("weekly fires %v", got)
	}
	for _, bad := range []struct{ expr, tz string }{{"* * * *", "UTC"}, {"* * * * * *", "UTC"}, {"@daily", "UTC"}, {"* * * * *", "Nope/Zone"}} {
		if _, err := scripts.NextFires(bad.expr, bad.tz, time.Now(), 1); err == nil {
			t.Errorf("%q in %q accepted", bad.expr, bad.tz)
		}
	}
}

type recorder struct {
	mu    sync.Mutex
	fires []string
}

func (r *recorder) fire(id string, due time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fires = append(r.fires, id+"@"+due.UTC().Format("15:04"))
}

func (r *recorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.fires...)
}

func (r *recorder) waitFor(t *testing.T, n int) []string {
	t.Helper()
	for i := 0; i < 500; i++ {
		if got := r.snapshot(); len(got) >= n {
			return got
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("fires = %v, want %d", r.snapshot(), n)
	return nil
}

type store struct {
	mu      sync.Mutex
	list    []scripts.CustomScript
	retired []string
}

func (s *store) set(list ...scripts.CustomScript) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list = list
}

func (s *store) get() ([]scripts.CustomScript, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]scripts.CustomScript(nil), s.list...), nil
}

func sched(id, cron string, enabled bool) scripts.CustomScript {
	return scripts.CustomScript{ID: id, Schedule: &scripts.Schedule{Cron: cron, Timezone: "UTC", Enabled: enabled}}
}

func newScheduler(clock *fakeclock.Clock, st *store, rec *recorder) *Scheduler {
	return &Scheduler{
		Clock: clock, fire: rec.fire, list: st.get,
		retire: func(id, reason string) {
			st.mu.Lock()
			defer st.mu.Unlock()
			st.retired = append(st.retired, id+":"+reason)
		},
	}
}

func TestSchedulerFiresAtExactInstants(t *testing.T) {
	clock := fakeclock.New(time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC))
	st, rec := &store{}, &recorder{}
	st.set(sched("a", "*/15 * * * *", true))
	s := newScheduler(clock, st, rec)
	s.Start()
	defer s.Close()
	for i := 1; i <= 4; i++ {
		clock.BlockUntil(1, time.Second)
		clock.Advance(15 * time.Minute)
		rec.waitFor(t, i)
	}
	want := []string{"a@08:15", "a@08:30", "a@08:45", "a@09:00"}
	got := rec.snapshot()
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("fires = %v, want %v", got, want)
		}
	}
}

func TestSchedulerMissesLateFireAndRearmsOnReload(t *testing.T) {
	clock := fakeclock.New(time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC))
	st, rec := &store{}, &recorder{}
	st.set(sched("a", "*/15 * * * *", true))
	s := newScheduler(clock, st, rec)
	s.Start()
	defer s.Close()
	clock.BlockUntil(1, time.Second)
	clock.Advance(15*time.Minute + 61*time.Second) // the 08:15 fire is 61 s late: missed
	clock.BlockUntil(1, time.Second)
	time.Sleep(50 * time.Millisecond)
	if got := rec.snapshot(); len(got) != 0 {
		t.Fatalf("a late fire ran: %v", got)
	}
	clock.Advance(14 * time.Minute) // 08:30 on time
	rec.waitFor(t, 1)
	if got := rec.snapshot(); got[0] != "a@08:30" {
		t.Fatalf("fires = %v", got)
	}
	// A changed cron re-arms from now; the old instant never fires.
	st.set(sched("a", "0 12 * * *", true))
	s.Reload()
	time.Sleep(50 * time.Millisecond)
	clock.Advance(15 * time.Minute)
	time.Sleep(50 * time.Millisecond)
	if got := rec.snapshot(); len(got) != 1 {
		t.Fatalf("old cron fired after reload: %v", got)
	}
}

func TestSchedulerDisabledNeverFiresAndRetires(t *testing.T) {
	clock := fakeclock.New(time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC))
	st, rec := &store{}, &recorder{}
	st.set(sched("on", "* * * * *", true), sched("off", "* * * * *", false))
	s := newScheduler(clock, st, rec)
	s.Start()
	defer s.Close()
	clock.BlockUntil(1, time.Second)
	clock.Advance(time.Minute)
	got := rec.waitFor(t, 1)
	if len(got) != 1 || got[0] != "on@08:01" {
		t.Fatalf("fires = %v", got)
	}
	st.set(sched("on", "* * * * *", false))
	s.Reload()
	for i := 0; i < 200; i++ {
		st.mu.Lock()
		n := len(st.retired)
		st.mu.Unlock()
		if n == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.retired) != 1 || st.retired[0] != "on:the schedule was turned off" {
		t.Fatalf("retired = %v", st.retired)
	}
}

func TestSchedulerCloseWhilePending(t *testing.T) {
	clock := fakeclock.New(time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC))
	st, rec := &store{}, &recorder{}
	st.set(sched("a", "0 9 * * *", true))
	s := newScheduler(clock, st, rec)
	s.Start()
	clock.BlockUntil(1, time.Second)
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close blocked with a timer pending")
	}
}

// stallClock models a runtime timer that does not advance during system sleep: wall time jumps with
// set, but a timer only fires when the test releases it.
type stallClock struct {
	mu      sync.Mutex
	now     time.Time
	waits   []time.Duration
	pending []chan time.Time
}

func (c *stallClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *stallClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	c.waits = append(c.waits, d)
	c.pending = append(c.pending, ch)
	return ch
}

func (c *stallClock) armed() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.waits)
}

func (c *stallClock) wake(now time.Time) {
	c.mu.Lock()
	c.now = now
	pending := c.pending
	c.pending = nil
	c.mu.Unlock()
	for _, ch := range pending {
		ch <- now
	}
}

func (c *stallClock) waitArmed(t *testing.T, n int) {
	t.Helper()
	for i := 0; i < 500 && c.armed() < n; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if c.armed() < n {
		t.Fatalf("timers armed = %d, want %d", c.armed(), n)
	}
}

func TestSchedulerSurvivesStalledTimer(t *testing.T) {
	clock := &stallClock{now: time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)}
	st, rec := &store{}, &recorder{}
	st.set(sched("a", "0 * * * *", true))
	s := &Scheduler{Clock: clock, fire: rec.fire, list: st.get, retire: func(string, string) {}}
	s.Start()
	defer s.Close()

	clock.waitArmed(t, 1)
	if clock.waits[0] > maxWait {
		t.Fatalf("first wait = %v, want <= %v", clock.waits[0], maxWait)
	}
	// Asleep 08:10 to 09:50: the 09:00 fire is far too late and is skipped.
	clock.wake(time.Date(2026, 6, 1, 9, 50, 0, 0, time.UTC))
	clock.waitArmed(t, 2)
	if got := rec.snapshot(); len(got) != 0 {
		t.Fatalf("a missed fire ran: %v", got)
	}
	// The 10:00 fire falls while awake and must run on time.
	clock.wake(time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC))
	if got := rec.waitFor(t, 1); got[0] != "a@10:00" {
		t.Fatalf("fires = %v, want a@10:00", got)
	}
}
