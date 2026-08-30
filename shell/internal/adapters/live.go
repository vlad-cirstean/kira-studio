package adapters

import "sync"

// live is the Go analogue of live.ts's Map<connectionId, Adapter> — mutex-guarded since, unlike
// the single-threaded Node engine, multiple goroutines can look an adapter up concurrently.
var live struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
}

func init() {
	live.adapters = make(map[string]Adapter)
}

// SetLiveAdapter is live.ts's setLiveAdapter.
func SetLiveAdapter(connectionID string, adapter Adapter) {
	live.mu.Lock()
	defer live.mu.Unlock()
	live.adapters[connectionID] = adapter
}

// GetLiveAdapter is live.ts's getLiveAdapter.
func GetLiveAdapter(connectionID string) (Adapter, bool) {
	live.mu.RLock()
	defer live.mu.RUnlock()
	a, ok := live.adapters[connectionID]
	return a, ok
}

// DeleteLiveAdapter is live.ts's deleteLiveAdapter.
func DeleteLiveAdapter(connectionID string) {
	live.mu.Lock()
	defer live.mu.Unlock()
	delete(live.adapters, connectionID)
}
