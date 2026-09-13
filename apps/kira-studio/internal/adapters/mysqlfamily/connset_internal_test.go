package mysqlfamily

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// White-box (package mysqlfamily) coverage for ConnSet.Acquire's per-connection lock — P21 round 2
// performance finding 3. A real dial (get()'s BuildConfig -> mysql.NewConnector -> db.Conn) needs a
// live server, so these tests pre-populate ConnSet.conns directly with a fake connEntry to reach
// get()'s cache-hit branch (the same key/lookup path a real, already-open connection takes) without
// ever touching the network — the lock semantics under test live entirely in Acquire/get, not in
// how the entry was first opened. *sql.Conn is never dereferenced by these tests (no query is ever
// run on it), so a nil one is a faithful enough stand-in for "some already-open connection".

func connSetWithFakeEntry(key string) *ConnSet {
	s := &ConnSet{conns: make(map[string]*connEntry)}
	s.conns[key] = &connEntry{conn: (*sql.Conn)(nil), threadID: 42}
	return s
}

// TestAcquireSerializesTwoCallersOnTheSameConnection is the finding's own regression: before this
// fix, ConnSet.Get handed back a bare *sql.Conn with no lock at all — two concurrent callers (two
// data tabs on the same database, or a Read racing a console Execute) could run statements on the
// same pinned, non-shareable connection at the same time. Acquire must now serialize them: the
// second caller's Acquire must not return until the first caller's release() runs.
func TestAcquireSerializesTwoCallersOnTheSameConnection(t *testing.T) {
	s := connSetWithFakeEntry(primaryKey)
	ctx := context.Background()

	_, release1, err := s.Acquire(ctx, "")
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}

	secondAcquired := make(chan struct{})
	go func() {
		_, release2, err := s.Acquire(ctx, "")
		if err != nil {
			t.Errorf("second Acquire: %v", err)
			close(secondAcquired)
			return
		}
		close(secondAcquired)
		release2()
	}()

	select {
	case <-secondAcquired:
		t.Fatal("second Acquire returned before the first caller's release() ran — the two callers were not serialized")
	case <-time.After(50 * time.Millisecond):
		// Expected: the second Acquire is still blocked on the entry's own lock.
	}

	release1()

	select {
	case <-secondAcquired:
		// The second Acquire unblocked once the first released, as it must.
	case <-time.After(1 * time.Second):
		t.Fatal("second Acquire never unblocked after the first caller's release()")
	}
}

// TestAcquireOnDifferentDatabasesDoesNotSerialize confirms the fix is a per-connection lock, not
// an accidental whole-ConnSet lock: two callers acquiring *different* databases' connections must
// not block each other at all.
func TestAcquireOnDifferentDatabasesDoesNotSerialize(t *testing.T) {
	s := connSetWithFakeEntry(primaryKey)
	s.conns["dbtwo"] = &connEntry{conn: (*sql.Conn)(nil), threadID: 43}
	ctx := context.Background()

	_, release1, err := s.Acquire(ctx, "")
	if err != nil {
		t.Fatalf("Acquire(primary): %v", err)
	}
	defer release1()

	done := make(chan struct{})
	go func() {
		_, release2, err := s.Acquire(ctx, "dbtwo")
		if err != nil {
			t.Errorf("Acquire(dbtwo): %v", err)
		} else {
			release2()
		}
		close(done)
	}()

	select {
	case <-done:
		// Expected: a different database's entry acquires immediately.
	case <-time.After(1 * time.Second):
		t.Fatal("Acquire on a different database blocked behind an unrelated connection's lock")
	}
}

// White-box coverage for P21 round 3 performance finding 5, porting postgres/client.go's own
// connset_internal_test.go verbatim: (a) detachLRULocked must only ever touch the map/lru, never a
// victim's own per-connection lock or its network Close(); (b) get()'s dial must be a single-flight
// per key, swapping mysqlNewConnector (the seam over mysql.NewConnector) for a fake with a
// controlled delay and outcome so genuine goroutine concurrency can be observed with no real MySQL
// server needed.

// TestDetachLRULocked_NeverTouchesVictimLock mirrors postgres's own test of the identical name.
func TestDetachLRULocked_NeverTouchesVictimLock(t *testing.T) {
	s := &ConnSet{conns: make(map[string]*connEntry)}
	for i := 0; i < maxConns; i++ {
		key := "db" + string(rune('a'+i))
		s.conns[key] = &connEntry{}
		s.lru = append(s.lru, key)
	}
	victimKey := s.lru[0]
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

// TestDetachLRULocked_NeverEvictsPrimary mirrors postgres's own test of the identical name.
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

// connSetForSingleFlightTest builds a ConnSet whose dial path never touches the network:
// mysqlNewConnector is swapped out for the caller's own fake for the duration of the test, so
// BuildConfig's own real work (parsing a zero-value model.ResolvedConnectionConfig) is the only
// thing that runs before it.
func connSetForSingleFlightTest(t *testing.T) *ConnSet {
	t.Helper()
	return &ConnSet{
		cfg: model.ResolvedConnectionConfig{},
		profile: Profile{
			Kind:               "test",
			ServerLabel:        "Test",
			ApplyEngineOptions: func(*mysql.Config, model.ResolvedConnectionConfig, LogFunc) {},
		},
		log:     func(string, string) {},
		conns:   make(map[string]*connEntry),
		dialing: make(map[string]*dialInFlight),
	}
}

// TestGet_SingleFlightPerKey is finding 5(b)'s own regression: get() used to dial with no lock
// held at all, so two concurrent get() calls for the same not-yet-open database both dialed, the
// second overwriting the first in the map — a leaked *sql.DB, its pinned *sql.Conn and a live
// MySQL server-side connection for the life of the app. This fires many concurrent get() calls for
// the *same* key against a fake mysqlNewConnector that counts how many dials are ever in flight at
// once (and sleeps briefly so a real race would have a real window to manifest) — the max observed
// concurrency for one key must be exactly 1.
func TestGet_SingleFlightPerKey(t *testing.T) {
	old := mysqlNewConnector
	t.Cleanup(func() { mysqlNewConnector = old })

	var inFlight int32
	var maxInFlight int32
	var totalDials int32
	mysqlNewConnector = func(_ *mysql.Config) (driver.Connector, error) {
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
		// No real driver.Connector to hand back without a live server; failing is enough to
		// exercise get()'s own single-flight path (every caller sees the same key, same in-flight
		// dial) without needing sql.OpenDB/db.Conn to succeed.
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
		t.Errorf("max concurrent dials for the same key = %d, want at most 1 — a real dial race would have leaked one *sql.DB (and one live MySQL connection) per overlap", got)
	}
	if atomic.LoadInt32(&totalDials) == 0 {
		t.Fatal("mysqlNewConnector was never called at all")
	}
}

// TestGet_DifferentKeysDialConcurrently confirms the single-flight above is per-key, not an
// accidental whole-ConnSet serialization: two different not-yet-open databases must still be able
// to dial at the same time.
func TestGet_DifferentKeysDialConcurrently(t *testing.T) {
	old := mysqlNewConnector
	t.Cleanup(func() { mysqlNewConnector = old })

	release := make(chan struct{})
	started := make(chan struct{}, 2)
	mysqlNewConnector = func(_ *mysql.Config) (driver.Connector, error) {
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
