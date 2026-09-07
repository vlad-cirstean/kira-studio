package gitsession

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// detailCacheCap is upstream's own 64-entry cap (D7).
const detailCacheCap = 64

// diffCacheCapBytes is upstream's own 4 MiB cap, evicted by total bytes rather than entry count
// (D7) — a handful of huge patches and thousands of tiny ones are both bounded the same way.
const diffCacheCapBytes = 4 << 20

type detailCacheKey struct {
	sha         string
	parentIndex int
}

// detailCache caches commit.detail results by <sha>:<parentIndex>, capped at detailCacheCap
// entries (plain LRU by entry count — a CommitDetail is small and roughly fixed-size, unlike a
// patch), and dropped **whole** on refsChanged (D7): one field of the cached value (decoration,
// %D) is a fact about refs, not about the commit, and there is no per-entry way to know which
// entries a given ref move actually touched.
type detailCache struct {
	mu    sync.Mutex
	order []detailCacheKey // least-recently-used first
	byKey map[detailCacheKey]porcelain.CommitDetail
}

func newDetailCache() *detailCache {
	return &detailCache{byKey: make(map[detailCacheKey]porcelain.CommitDetail)}
}

func (c *detailCache) get(sha string, parentIndex int) (porcelain.CommitDetail, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := detailCacheKey{sha, parentIndex}
	v, ok := c.byKey[key]
	if !ok {
		return porcelain.CommitDetail{}, false
	}
	c.touchLocked(key)
	return v, true
}

func (c *detailCache) set(sha string, parentIndex int, v porcelain.CommitDetail) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := detailCacheKey{sha, parentIndex}
	if _, exists := c.byKey[key]; exists {
		c.removeFromOrderLocked(key)
	}
	c.byKey[key] = v
	c.order = append(c.order, key)
	for len(c.order) > detailCacheCap {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.byKey, oldest)
	}
}

// dropAll evicts every entry — called on refsChanged, before the fan-out (entry.go's note),
// mirroring G3 D13's ordering rule for marking a Walk stale.
func (c *detailCache) dropAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = nil
	c.byKey = make(map[detailCacheKey]porcelain.CommitDetail)
}

func (c *detailCache) touchLocked(key detailCacheKey) {
	c.removeFromOrderLocked(key)
	c.order = append(c.order, key)
}

func (c *detailCache) removeFromOrderLocked(key detailCacheKey) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

type diffCacheKey struct {
	baseSHA string // "" for a root commit — the empty tree has no sha of its own to key on
	sha     string
	path    string
}

type diffCacheEntry struct {
	body  porcelain.FileDiffBody
	bytes int64 // this entry's own weight — the raw patch's byte length (D2's own "the real patch
	// size"), reused as the cache's accounting unit so the two numbers can never diverge
}

// diffCache caches one file's patch by <baseSha>:<sha>:<path>, LRU-evicted by total bytes (D7),
// and **never invalidated**: two tree oids and a path determine a patch forever, which is exactly
// why this cache carries no drop-on-refsChanged logic at all — that absence is deliberate, not an
// oversight (D7).
type diffCache struct {
	mu       sync.Mutex
	capacity int64
	total    int64
	order    []diffCacheKey // least-recently-used first
	byKey    map[diffCacheKey]diffCacheEntry
}

func newDiffCache(capacityBytes int64) *diffCache {
	return &diffCache{capacity: capacityBytes, byKey: make(map[diffCacheKey]diffCacheEntry)}
}

func (c *diffCache) get(baseSHA, sha, path string) (porcelain.FileDiffBody, int64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := diffCacheKey{baseSHA, sha, path}
	e, ok := c.byKey[key]
	if !ok {
		return porcelain.FileDiffBody{}, 0, false
	}
	c.touchLocked(key)
	return e.body, e.bytes, true
}

func (c *diffCache) set(baseSHA, sha, path string, body porcelain.FileDiffBody, bytes int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := diffCacheKey{baseSHA, sha, path}
	if existing, ok := c.byKey[key]; ok {
		c.total -= existing.bytes
		c.removeFromOrderLocked(key)
	}
	c.byKey[key] = diffCacheEntry{body: body, bytes: bytes}
	c.order = append(c.order, key)
	c.total += bytes
	for c.total > c.capacity && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		c.total -= c.byKey[oldest].bytes
		delete(c.byKey, oldest)
	}
}

// clear drops every entry — called from RepoEntry.teardown alongside the detail cache, for
// symmetry (the entry itself is being destroyed either way, so this is not load-bearing).
func (c *diffCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = nil
	c.total = 0
	c.byKey = make(map[diffCacheKey]diffCacheEntry)
}

func (c *diffCache) touchLocked(key diffCacheKey) {
	c.removeFromOrderLocked(key)
	c.order = append(c.order, key)
}

func (c *diffCache) removeFromOrderLocked(key diffCacheKey) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}
