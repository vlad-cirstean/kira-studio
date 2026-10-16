package mobileweb

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// limiterSet is a bounded map of token-bucket limiters keyed by remote IP or device id. Idle
// entries are swept; a full map denies new keys rather than growing without bound.
type limiterSet struct {
	limit   rate.Limit
	burst   int
	maxKeys int
	now     func() time.Time

	mu sync.Mutex
	m  map[string]*limiterEntry
}

type limiterEntry struct {
	lim  *rate.Limiter
	last time.Time
}

const (
	maxLimiterKeys = 1024
	limiterIdle    = 10 * time.Minute
)

func newLimiterSet(limit rate.Limit, burst int, now func() time.Time) *limiterSet {
	return &limiterSet{limit: limit, burst: burst, maxKeys: maxLimiterKeys, now: now, m: map[string]*limiterEntry{}}
}

// entryLocked returns the key's limiter, creating it unless the map is full of live entries.
func (s *limiterSet) entryLocked(key string, now time.Time) *limiterEntry {
	e, ok := s.m[key]
	if ok {
		e.last = now
		return e
	}
	if len(s.m) >= s.maxKeys {
		s.sweepLocked(now)
		if len(s.m) >= s.maxKeys {
			return nil
		}
	}
	e = &limiterEntry{lim: rate.NewLimiter(s.limit, s.burst), last: now}
	s.m[key] = e
	return e
}

// allow consumes one token for key; false when the bucket is empty.
func (s *limiterSet) allow(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	e := s.entryLocked(key, now)
	return e != nil && e.lim.AllowN(now, 1)
}

// exhausted reports whether key has no token left, without consuming one.
func (s *limiterSet) exhausted(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	e, ok := s.m[key]
	if !ok {
		return false
	}
	return e.lim.TokensAt(now) < 1
}

func (s *limiterSet) sweepLocked(now time.Time) {
	for k, e := range s.m {
		if now.Sub(e.last) > limiterIdle {
			delete(s.m, k)
		}
	}
}

// sweep drops idle entries; the server calls it on a timer.
func (s *limiterSet) sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(s.now())
}
