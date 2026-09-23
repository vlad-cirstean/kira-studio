package adapters

import "sync"

// QueryTracker is index.ts's opRuntime's own trackerFor/inFlight bookkeeping, generalized over the
// per-engine "running query" identity Q (mysqlfamily/postgres's own RunningQuery struct; a bare
// query_id string for clickhouse) — postgres/mysqlfamily/clickhouse's own adapter.go each carried
// this verbatim (P13 D3).
type QueryTracker[Q comparable] struct {
	mu sync.Mutex
	// inFlight counts query.go/console.go's own adapters.RunWithAbortRace background goroutines
	// still touching a connection. RunWithAbortRace can return to its caller (on ctx.Done()) well
	// before the goroutine it spawned actually stops using the connection — by design, so a local
	// op abort does not itself kill the query (query.ts:77-80). Disconnect must not close a
	// connection out from under one of these goroutines.
	inFlight    sync.WaitGroup
	runningByOp map[string]Q
}

// TrackerFor registers q as opID's own running query and hands back its release, called once the
// statement settles. The identity check in the release closure is what makes a multi-statement op
// (mutate's insert, console's "Run all") correct: a later query for the same opID must not have its
// own registration erased by an earlier one's stale release.
func (t *QueryTracker[Q]) TrackerFor(opID string) func(q Q) (release func()) {
	return func(q Q) func() {
		t.mu.Lock()
		if t.runningByOp == nil {
			t.runningByOp = make(map[string]Q)
		}
		t.runningByOp[opID] = q
		t.mu.Unlock()
		t.inFlight.Add(1)
		return func() {
			defer t.inFlight.Done()
			t.mu.Lock()
			if t.runningByOp[opID] == q {
				delete(t.runningByOp, opID)
			}
			t.mu.Unlock()
		}
	}
}

// PopRunning is Cancel's own lookup: the running query registered for opID, if any, removed from
// the map in the same locked step so a racing release can never re-delete a different (later)
// query's own registration for the same opID.
func (t *QueryTracker[Q]) PopRunning(opID string) (q Q, ok bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	q, ok = t.runningByOp[opID]
	delete(t.runningByOp, opID)
	return q, ok
}

// Drain is Disconnect's own cleanup chain: wait for every still-in-flight query's own release to
// run (see inFlight's own doc comment — a caller that wants this to return promptly on a stuck
// query calls Cancel first, matching CancelOp's own two-step design), then clear the map.
func (t *QueryTracker[Q]) Drain() {
	t.inFlight.Wait()
	t.mu.Lock()
	t.runningByOp = nil
	t.mu.Unlock()
}
