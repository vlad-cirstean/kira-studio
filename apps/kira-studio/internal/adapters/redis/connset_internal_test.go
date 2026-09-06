package redis

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// White-box (package redis) coverage for P21 round 3 performance finding 5, porting
// postgres/client.go's own connset_internal_test.go (and mysqlfamily's identical port): (a)
// detachLRULocked must only ever touch the map/lru, never block on anything the caller must close
// itself; (b) get()'s dial must be a single-flight per db index, swapping redisPing (the seam over
// the one real network round trip dial makes) for a fake with a controlled delay and outcome so
// genuine goroutine concurrency can be observed with no real Redis server needed.

// TestDetachLRULocked_NeverEvictsDefault mirrors postgres/mysqlfamily's own "never evicts the
// primary" test — here, "the primary" is defaultDbIndex, which client.ts's own contract (D9) never
// evicts even when it is the least-recently-used entry.
func TestDetachLRULocked_NeverEvictsDefault(t *testing.T) {
	s := &dbConnectionSet{defaultDbIndex: 0, connections: make(map[int]*goredis.Client)}
	defaultClient := &goredis.Client{}
	s.connections[0] = defaultClient
	s.lru = append(s.lru, 0)
	sideClient := &goredis.Client{}
	s.connections[5] = sideClient
	s.lru = append(s.lru, 5)

	got := s.detachLRULocked()
	if got != sideClient {
		t.Fatalf("detachLRULocked returned %+v, want the non-default entry %+v", got, sideClient)
	}
	if _, stillPresent := s.connections[0]; !stillPresent {
		t.Error("the default db index connection was evicted — it must never be")
	}
	if _, stillPresent := s.connections[5]; stillPresent {
		t.Error("the evicted entry is still present in connections")
	}
}

// TestDetachLRULocked_NoOpWhenOnlyDefaultIsOpen confirms the "everything open is the default"
// no-op path returns nil rather than picking the default anyway.
func TestDetachLRULocked_NoOpWhenOnlyDefaultIsOpen(t *testing.T) {
	s := &dbConnectionSet{defaultDbIndex: 0, connections: make(map[int]*goredis.Client)}
	s.connections[0] = &goredis.Client{}
	s.lru = append(s.lru, 0)

	if got := s.detachLRULocked(); got != nil {
		t.Fatalf("detachLRULocked() = %+v, want nil (only the default db index is open)", got)
	}
	if _, stillPresent := s.connections[0]; !stillPresent {
		t.Error("the default db index connection was evicted — it must never be")
	}
}

// connSetForSingleFlightTest builds a dbConnectionSet whose dial path never touches the network:
// redisPing is swapped out for the caller's own fake for the duration of the test.
func connSetForSingleFlightTest() *dbConnectionSet {
	return newDbConnectionSet(connectFields{host: "127.0.0.1", port: 6379}, 0, func(string, string) {})
}

// TestGet_SingleFlightPerDbIndex is finding 5(b)'s own regression: get() used to dial with no lock
// held at all, so two concurrent get() calls for the same not-yet-open db index both dialed, the
// second overwriting the first in the map — a leaked *goredis.Client and its whole connection pool
// for the life of the app. This fires many concurrent get() calls for the *same* db index against a
// fake redisPing that counts how many dials are ever in flight at once (and sleeps briefly so a
// real race would have a real window to manifest) — the max observed concurrency for one index
// must be exactly 1.
func TestGet_SingleFlightPerDbIndex(t *testing.T) {
	old := redisPing
	t.Cleanup(func() { redisPing = old })

	var inFlight int32
	var maxInFlight int32
	var totalDials int32
	redisPing = func(_ context.Context, _ *goredis.Client) error {
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
		// No real server to succeed against; failing is enough to exercise get()'s own
		// single-flight path (every caller sees the same db index, same in-flight dial).
		return context.DeadlineExceeded
	}

	s := connSetForSingleFlightTest()
	const callers = 12
	var wg sync.WaitGroup
	wg.Add(callers)
	for i := 0; i < callers; i++ {
		go func() {
			defer wg.Done()
			_, _ = s.get(context.Background(), 3)
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&maxInFlight); got > 1 {
		t.Errorf("max concurrent dials for the same db index = %d, want at most 1 — a real dial race would have leaked one *goredis.Client (and its connection pool) per overlap", got)
	}
	if atomic.LoadInt32(&totalDials) == 0 {
		t.Fatal("redisPing was never called at all")
	}
}

// TestGet_DifferentDbIndexesDialConcurrently confirms the single-flight above is per db index, not
// an accidental whole-set serialization: two different not-yet-open db indexes must still be able
// to dial at the same time.
func TestGet_DifferentDbIndexesDialConcurrently(t *testing.T) {
	old := redisPing
	t.Cleanup(func() { redisPing = old })

	release := make(chan struct{})
	started := make(chan struct{}, 2)
	redisPing = func(_ context.Context, _ *goredis.Client) error {
		started <- struct{}{}
		<-release
		return context.DeadlineExceeded
	}

	s := connSetForSingleFlightTest()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = s.get(context.Background(), 1)
	}()
	go func() {
		defer wg.Done()
		_, _ = s.get(context.Background(), 2)
	}()

	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(1 * time.Second):
			t.Fatal("both different-db-index dials never started concurrently — one index's dial appears to block the other's")
		}
	}
	close(release)
	wg.Wait()
}
