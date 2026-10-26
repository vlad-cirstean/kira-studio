package gitsession

import (
	"context"
	"sync"
	"time"
)

// crShared coordinates the change request syncers of one registry. Linked worktrees and clones of
// one remote are separate entries with one repo key; their syncers share one index and one sync
// state row, so a run holds the key's gate from the state read to the state write.
type crShared struct {
	mu   sync.Mutex
	keys map[string]*crKey
}

type crKey struct {
	gate  chan struct{}
	peers map[*RepoEntry]struct{}
	// lastPending spaces pending-checks refreshes across the key's syncers; the gate guards it.
	lastPending time.Time
}

func newCRShared() *crShared { return &crShared{keys: map[string]*crKey{}} }

func (c *crShared) keyLocked(key string) *crKey {
	k, ok := c.keys[key]
	if !ok {
		k = &crKey{gate: make(chan struct{}, 1), peers: map[*RepoEntry]struct{}{}}
		c.keys[key] = k
	}
	return k
}

func (c *crShared) attach(key string, e *RepoEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.keyLocked(key).peers[e] = struct{}{}
}

func (c *crShared) detach(key string, e *RepoEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if k, ok := c.keys[key]; ok {
		delete(k.peers, e)
	}
}

// peers lists the entries attached to key, so a change reaches every window's subscribers.
func (c *crShared) peers(key string) []*RepoEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	k, ok := c.keys[key]
	if !ok {
		return nil
	}
	out := make([]*RepoEntry, 0, len(k.peers))
	for e := range k.peers {
		out = append(out, e)
	}
	return out
}

// acquire takes the key's gate; ok is false when ctx ended first. The returned key is valid until
// release is called.
func (c *crShared) acquire(ctx context.Context, key string) (k *crKey, release func(), ok bool) {
	c.mu.Lock()
	k = c.keyLocked(key)
	c.mu.Unlock()
	select {
	case k.gate <- struct{}{}:
		return k, func() { <-k.gate }, true
	case <-ctx.Done():
		return nil, nil, false
	}
}
