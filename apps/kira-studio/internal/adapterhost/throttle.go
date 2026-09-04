package adapterhost

import (
	"math"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// throttleMaxWait bounds how long RunOp will wait for a token before giving up with E_TIMEOUT
// (P28 §5.4) — a pathological rate/queue-depth combination (e.g. 0.1/s with 50 queued reads) must
// not look like a hung app forever.
const throttleMaxWait = 30 * time.Second

// throttledKinds is every op kind RunOp actually paces — every real kind (P28 §5.5) EXCEPT
// connect/disconnect/test: a throttle must never be able to lock a user out of connecting to, or
// disconnecting from, the connection whose throttle is misconfigured, and test runs against a
// throwaway adapter that was never registered live and carries no connection id at all.
var throttledKinds = map[string]bool{
	"read": true, "count": true, "mutate": true, "execute": true, "transfer": true,
	"children": true, "describe": true, "definition": true,
}

// throttleRegistry maps a connection id to its live *rate.Limiter. A dedicated mutex, not
// Host.mu, so the hot running map (touched on every op) never contends with a config write from
// Service.Update or a disconnect's clear.
type throttleRegistry struct {
	mu       sync.RWMutex
	limiters map[string]*rate.Limiter
}

func newThrottleRegistry() *throttleRegistry {
	return &throttleRegistry{limiters: make(map[string]*rate.Limiter)}
}

// set installs (perSec > 0) or clears (perSec <= 0) connectionID's rate limit. Burst is
// max(1, min(10, round(perSec))) (§5.3): a strict burst of 1 would delay the first click after an
// idle period, making a correctly-configured limit feel broken; a small burst lets interactive use
// through immediately and paces only sustained traffic, which is what a server-side limit actually
// cares about.
func (t *throttleRegistry) set(connectionID string, perSec float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if perSec <= 0 {
		delete(t.limiters, connectionID)
		return
	}
	burst := int(math.Round(perSec))
	if burst < 1 {
		burst = 1
	}
	if burst > 10 {
		burst = 10
	}
	t.limiters[connectionID] = rate.NewLimiter(rate.Limit(perSec), burst)
}

// limiterFor returns the live limiter for connectionID, or nil when the connection is unthrottled.
func (t *throttleRegistry) limiterFor(connectionID string) *rate.Limiter {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.limiters[connectionID]
}
