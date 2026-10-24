package docker

import (
	"testing"
	"time"
)

func TestReconcile(t *testing.T) {
	tm := restoreTiming{tick: time.Second, grace: 30 * time.Second, policyWait: 60 * time.Second}
	const sec = int64(1000)
	run := func(id, name string) obsContainer { return obsContainer{ID: id, Name: name, Running: true} }
	stopped := func(id, name string) obsContainer { return obsContainer{ID: id, Name: name} }
	obs := func(boot string, cs ...obsContainer) observation {
		return observation{EngineID: "eng", BootID: boot, BootAt: 1000 * sec, Containers: cs}
	}
	tracking := func(boot string, es ...RestoreEntry) *RestoreSnapshot {
		return &RestoreSnapshot{EngineID: "eng", BootID: boot, BootAt: 1000 * sec, State: stateTracking, Entries: es}
	}
	ent := func(id, name string) RestoreEntry { return RestoreEntry{ID: id, Name: name} }
	status := func(s RestoreSnapshot, o observation, now int64) map[string]string {
		m := map[string]string{}
		for _, it := range itemStatuses(s, o, now, tm) {
			m[it.ID] = it.Status
		}
		return m
	}

	t.Run("first sight snapshots running, skips excluded and --rm", func(t *testing.T) {
		ex, rm := run("c", "tc"), run("d", "tmp")
		ex.Excluded, rm.AutoRemove = true, true
		s, ch := reconcile(nil, obs("b1", run("a", "a"), stopped("b", "b"), ex, rm), 5*sec, tm)
		if !ch || len(s.Entries) != 1 || s.Entries[0].ID != "a" {
			t.Fatalf("got %+v changed=%v", s.Entries, ch)
		}
	})

	t.Run("blip with same boot offers nothing and keeps entries inside grace", func(t *testing.T) {
		prev := tracking("b1", ent("a", "a"))
		s, _ := reconcile(prev, obs("b1", stopped("a", "a")), 2000*sec, tm)
		if s.State != stateTracking || len(s.Entries) != 1 || s.Entries[0].StoppedSeenAt != 2000*sec {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("user stop past grace drops the entry; later boot change offers nothing", func(t *testing.T) {
		e := ent("a", "a")
		e.StoppedSeenAt = 2000 * sec
		s, ch := reconcile(tracking("b1", e), obs("b1", stopped("a", "a")), 2031*sec, tm)
		if !ch || len(s.Entries) != 0 {
			t.Fatalf("got %+v", s)
		}
		s, _ = reconcile(&s, obs("b2", stopped("a", "a")), 2040*sec, tm)
		if s.State != stateTracking || s.BootID != "b2" {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("boot change within grace of a shutdown casualty goes pending", func(t *testing.T) {
		e := ent("a", "a")
		e.StoppedSeenAt = 2000 * sec
		o := obs("b2", stopped("a", "a"))
		o.BootAt = 2010 * sec
		s, ch := reconcile(tracking("b1", e), o, 2011*sec, tm)
		if !ch || s.State != statePending || s.DetectedAt != 2011*sec {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("live-restore keeps boot and containers: nothing", func(t *testing.T) {
		s, ch := reconcile(tracking("b1", ent("a", "a")), obs("b1", run("a", "a")), 2000*sec, tm)
		if ch || s.State != stateTracking {
			t.Fatalf("got %+v changed=%v", s, ch)
		}
	})

	t.Run("restart where everything came back stays tracking on the new boot", func(t *testing.T) {
		s, ch := reconcile(tracking("b1", ent("a", "a")), obs("b2", run("a", "a")), 2000*sec, tm)
		if !ch || s.State != stateTracking || s.BootID != "b2" {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("only gone items do not go pending", func(t *testing.T) {
		s, _ := reconcile(tracking("b1", ent("a", "a")), obs("b2"), 2000*sec, tm)
		if s.State != stateTracking {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("policy container waits, then is restorable; name match counts as back", func(t *testing.T) {
		keeper, solo := ent("k", "keeper"), ent("s", "solo")
		keeper.RestartPolicy = "always"
		o := obs("b2", stopped("k", "keeper"), stopped("s", "solo"))
		s, _ := reconcile(tracking("b1", keeper, solo, ent("old", "web")), o, 1010*sec, tm)
		if s.State != statePending {
			t.Fatalf("got %+v", s)
		}
		o.Containers = append(o.Containers, run("new", "web"))
		got := status(s, o, 1010*sec)
		if got["k"] != itemWaiting || got["s"] != itemRestorable || got["old"] != itemBack {
			t.Fatalf("got %v", got)
		}
		if status(s, o, 1070*sec)["k"] != itemRestorable {
			t.Fatal("policy container still waiting past policyWait")
		}
	})

	t.Run("pending is frozen, follows a second restart, clears when nothing is open", func(t *testing.T) {
		p := tracking("b1", ent("a", "a"))
		p.State, p.DetectedAt = statePending, 1500*sec
		o := obs("b3", stopped("a", "a"), run("n", "n"))
		o.BootAt = 3000 * sec
		s, ch := reconcile(p, o, 3001*sec, tm)
		if !ch || s.State != statePending || s.BootID != "b3" || len(s.Entries) != 1 || s.DetectedAt != 1500*sec {
			t.Fatalf("got %+v", s)
		}
		s, _ = reconcile(&s, obs("b3", run("a", "a")), 3002*sec, tm)
		if s.State != stateTracking {
			t.Fatalf("got %+v", s)
		}
	})

	t.Run("unchanged snapshot refreshes updated_at once a day so prune keys on last seen", func(t *testing.T) {
		prev := tracking("b1", ent("a", "a"))
		prev.UpdatedAt = 1000 * sec
		if _, ch := reconcile(prev, obs("b1", run("a", "a")), 1000*sec+3600*sec, tm); ch {
			t.Fatal("touched within a day")
		}
		s, ch := reconcile(prev, obs("b1", run("a", "a")), 1000*sec+25*3600*sec, tm)
		if !ch || s.UpdatedAt != 1000*sec+25*3600*sec {
			t.Fatalf("got %+v changed=%v", s, ch)
		}
	})

	t.Run("no bridge: observed outage offers entries that stopped inside it", func(t *testing.T) {
		in, before := ent("a", "a"), ent("b", "b")
		o := obs("", stopped("a", "a"), stopped("b", "b"))
		o.UnreachableSince = 2000 * sec
		o.Containers[0].FinishedAt = 2001 * sec
		o.Containers[1].FinishedAt = 100 * sec
		s, _ := reconcile(tracking("", in, before), o, 2010*sec, tm)
		if s.State != statePending || len(s.Entries) != 1 || s.Entries[0].ID != "a" {
			t.Fatalf("got %+v", s)
		}
		o.UnreachableSince = 0
		s, _ = reconcile(tracking("", in), o, 2010*sec, tm)
		if s.State != stateTracking {
			t.Fatalf("no outage seen, got %+v", s)
		}
	})
}

func TestPublishEmitsOnEngineSwitch(t *testing.T) {
	rec := &recorder{}
	r := newRestoreTracker(&Manager{Emit: rec})
	none := func(engine string) {
		r.publish(&RestoreSnapshot{EngineID: engine}, observation{EngineID: engine}, 0)
	}
	count := func() int { rec.mu.Lock(); defer rec.mu.Unlock(); return len(rec.events) }
	none("a")
	none("a")
	if count() != 0 {
		t.Fatalf("idle engine emitted %d", count())
	}
	none("b")
	if count() != 1 {
		t.Fatalf("switch must emit once, got %d", count())
	}
	none("b")
	if count() != 1 {
		t.Fatalf("repeat none emitted, got %d", count())
	}
}
