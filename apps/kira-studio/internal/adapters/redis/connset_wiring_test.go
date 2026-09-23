package redis

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// White-box (package redis) coverage for newDbConnectionSet's own wiring onto adapters.ConnSet
// (P107 T2-2): the LRU/single-flight behaviour itself is covered once, generically, by
// internal/adapters's own connset_test.go — this just confirms get (via the real Dial/Close
// closures newDbConnectionSet builds) still serializes concurrent dials for the same db index with
// no real Redis server needed.
func TestGet_SingleFlightPerDbIndex(t *testing.T) {
	old := redisPing
	t.Cleanup(func() { redisPing = old })

	var inFlight, maxInFlight, totalDials int32
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
		return context.DeadlineExceeded
	}

	s := newDbConnectionSet(connectFields{host: "127.0.0.1", port: 6379}, 0, func(string, string) {})
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
		t.Errorf("max concurrent dials for the same db index = %d, want at most 1", got)
	}
	if atomic.LoadInt32(&totalDials) == 0 {
		t.Fatal("redisPing was never called at all")
	}
}
