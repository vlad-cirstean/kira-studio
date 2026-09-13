package postgres

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// White-box (package postgres) coverage for two independent fixes over ConnSet.get, P21 round 2
// performance finding 4. Neither needs a real Postgres server: (a) is pure map manipulation, and
// (b) swaps pgxConnect (the package-level seam over pgx.ConnectConfig) for a fake with a
// controlled delay and outcome, so genuine goroutine concurrency can be observed with no network
// dial at all.

// TestDetachLRULocked_NeverTouchesVictimLock is finding 4(a)'s own regression: the old
// evictLRULocked took the victim's own per-connection lock (held for the victim's entire in-flight
// op) and closed its network connection while s.mu was still held by get()'s caller — so opening a
// 9th database while a long query ran on the LRU victim blocked every other database of this
// connection, including a bare map lookup for an unrelated, already-open primary. detachLRULocked
// must only ever touch the map/lru, never victim.mu — this locks the victim's own mu *before*
// calling detachLRULocked and asserts it still returns immediately.
func TestDetachLRULocked_NeverTouchesVictimLock(t *testing.T) {
	s := &ConnSet{conns: make(map[string]*connEntry)}
	for i := 0; i < maxConns; i++ {
		key := "db" + string(rune('a'+i))
		s.conns[key] = &connEntry{}
		s.lru = append(s.lru, key)
	}
	victimKey := s.lru[0] // the least-recently-used entry, and detachLRULocked's own pick
	victim := s.conns[victimKey]
	victim.mu.Lock() // simulates "an op is still running on this connection"
	defer victim.mu.Unlock()

	done := make(chan *connEntry, 1)
	go func() {
		done <- s.detachLRULocked()
	}()

	select {
	case got := <-done:
		if got != victim {
			t.Fatalf("detachLRULocked returned %+v, want the LRU victim %+v", got, victim)
		}
		if _, stillPresent := s.conns[victimKey]; stillPresent {
			t.Errorf("victim key %q is still in conns after detachLRULocked", victimKey)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("detachLRULocked blocked on the victim's own lock — it must only touch the map/lru, never victim.mu")
	}
}

// TestDetachLRULocked_NeverEvictsPrimary confirms the primary key (never real user data — the
// sentinel every op falls back to) is skipped even when it is the least-recently-used entry.
func TestDetachLRULocked_NeverEvictsPrimary(t *testing.T) {
	s := &ConnSet{conns: make(map[string]*connEntry)}
	primary := &connEntry{}
	s.conns[primaryKey] = primary
	s.lru = append(s.lru, primaryKey)
	sidedb := &connEntry{}
	s.conns["sidedb"] = sidedb
	s.lru = append(s.lru, "sidedb")

	got := s.detachLRULocked()
	if got != sidedb {
		t.Fatalf("detachLRULocked returned %+v, want the non-primary entry %+v", got, sidedb)
	}
	if _, stillPresent := s.conns[primaryKey]; !stillPresent {
		t.Error("the primary connection was evicted — it must never be")
	}
}

// connSetForSingleFlightTest builds a ConnSet whose dial path never touches the network: a
// zero-value model.ResolvedConnectionConfig makes buildConfig succeed trivially (fields mode, no
// sslmode option to fail on), and pgxConnect is swapped out for the caller's own fake for the
// duration of the test.
func connSetForSingleFlightTest(t *testing.T) *ConnSet {
	t.Helper()
	return &ConnSet{
		cfg:     model.ResolvedConnectionConfig{},
		log:     func(string, string) {},
		conns:   make(map[string]*connEntry),
		dialing: make(map[string]*dialInFlight),
	}
}

// TestGet_SingleFlightPerKey is finding 4(b)'s own regression: get() used to dial with no lock
// held at all, so two concurrent get() calls for the same not-yet-open database both dialed, the
// second overwriting the first in the map — a leaked *pgx.Conn and a leaked live Postgres backend
// process for the life of the app. This fires many concurrent get() calls for the *same* key
// against a fake pgxConnect that counts how many dials are ever in flight at once (and sleeps
// briefly so a real race would have a real window to manifest) — the max observed concurrency for
// one key must be exactly 1.
func TestGet_SingleFlightPerKey(t *testing.T) {
	old := pgxConnect
	t.Cleanup(func() { pgxConnect = old })

	var inFlight int32
	var maxInFlight int32
	var totalDials int32
	pgxConnect = func(ctx context.Context, _ *pgx.ConnConfig) (*pgx.Conn, error) {
		n := atomic.AddInt32(&inFlight, 1)
		atomic.AddInt32(&totalDials, 1)
		for {
			m := atomic.LoadInt32(&maxInFlight)
			if n <= m || atomic.CompareAndSwapInt32(&maxInFlight, m, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		// No real *pgx.Conn to hand back without a live server; failing is enough to exercise
		// get()'s own single-flight path (every caller sees the same key, same in-flight dial)
		// without needing a fake connEntry.conn that nothing here ever calls a method on.
		return nil, context.DeadlineExceeded
	}

	s := connSetForSingleFlightTest(t)
	const callers = 12
	var wg sync.WaitGroup
	wg.Add(callers)
	for i := 0; i < callers; i++ {
		go func() {
			defer wg.Done()
			_, _ = s.get(context.Background(), "samedb")
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&maxInFlight); got > 1 {
		t.Errorf("max concurrent dials for the same key = %d, want at most 1 — a real dial race would have leaked one *pgx.Conn (and one live Postgres backend) per overlap", got)
	}
	if atomic.LoadInt32(&totalDials) == 0 {
		t.Fatal("pgxConnect was never called at all")
	}
}

// TestGet_DifferentKeysDialConcurrently confirms the single-flight above is per-key, not an
// accidental whole-ConnSet serialization: two different not-yet-open databases must still be able
// to dial at the same time.
func TestGet_DifferentKeysDialConcurrently(t *testing.T) {
	old := pgxConnect
	t.Cleanup(func() { pgxConnect = old })

	release := make(chan struct{})
	started := make(chan struct{}, 2)
	pgxConnect = func(ctx context.Context, _ *pgx.ConnConfig) (*pgx.Conn, error) {
		started <- struct{}{}
		<-release
		return nil, context.DeadlineExceeded
	}

	s := connSetForSingleFlightTest(t)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = s.get(context.Background(), "dbone")
	}()
	go func() {
		defer wg.Done()
		_, _ = s.get(context.Background(), "dbtwo")
	}()

	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(1 * time.Second):
			t.Fatal("both different-key dials never started concurrently — one key's dial appears to block the other's")
		}
	}
	close(release)
	wg.Wait()
}
