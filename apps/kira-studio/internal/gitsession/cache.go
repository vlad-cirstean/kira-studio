package gitsession

import (
	"container/list"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
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

// refsCache is refs.list's own single-value cache (D10) — a repository has one ref list, not
// many, so no LRU is needed here, unlike detailCache/diffCache. Dropped whole on refsChanged,
// before the fan-out (entry.go's note), the same ordering G4 D7 established for the detail cache.
// Pre-flight and the write executor never read it (D10/F16): a decision that precedes a write
// always takes a fresh snapshot.
type refsCache struct {
	mu    sync.Mutex
	value RefsResult
	valid bool
}

func newRefsCache() *refsCache { return &refsCache{} }

func (c *refsCache) get() (RefsResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.valid {
		return RefsResult{}, false
	}
	return c.value, true
}

func (c *refsCache) set(v RefsResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = v
	c.valid = true
}

func (c *refsCache) drop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = RefsResult{}
	c.valid = false
}

// stackCache is stack.list's own single-value cache (G26 D3/D16) — the same "one repository, one
// value" shape refsCache already established, dropped whole on refsChanged and by
// invalidateAfterWrite (RunRestack and stackSet both go through the latter). Pre-flight
// (RestackPreflight) never reads it — the same "a decision that precedes a write always takes a
// fresh snapshot" rule D10/F16 already state for refsCache.
type stackCache struct {
	mu    sync.Mutex
	value gitpreflight.StackListResult
	valid bool
}

func newStackCache() *stackCache { return &stackCache{} }

func (c *stackCache) get() (gitpreflight.StackListResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.valid {
		return gitpreflight.StackListResult{}, false
	}
	return c.value, true
}

func (c *stackCache) set(v gitpreflight.StackListResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = v
	c.valid = true
}

func (c *stackCache) drop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = gitpreflight.StackListResult{}
	c.valid = false
}

// mergeBaseCacheCap mirrors detailCacheCap — a merge-base result is small and roughly fixed-size,
// the same shape reasoning that constant already documents.
const mergeBaseCacheCap = 64

type mergeBaseCacheKey struct {
	base   string
	branch string
}

type mergeBaseCacheValue struct {
	sha string
	ok  bool // false = merge-base's own exit 1, "unrelated histories" (probe P2) — a real, stable,
	// cacheable answer, not an error.
}

// mergeBaseCache caches `git merge-base <base> <branch>`'s own result by (base, branch) REF NAME
// pair (G30 round-1 performance review, finding #8: every review RPC — review.files,
// review.fileDiff, RangeFiles's other caller — re-spawned this uncached, once per request, even
// though the same (base, branch) pair is looked up on nearly every one of them while a review
// session sits open). base/branch are ref names, not shas, so — the same reasoning detailCache's
// own dropAll already documents for refs/%D decoration — a ref moving can change what its own
// merge-base with another ref resolves to, and there is no per-entry way to know which cached
// pairs a given ref move actually touched: dropped **whole** on refsChanged, capped at
// mergeBaseCacheCap entries (plain LRU by entry count).
type mergeBaseCache struct {
	mu    sync.Mutex
	order []mergeBaseCacheKey
	byKey map[mergeBaseCacheKey]mergeBaseCacheValue
}

func newMergeBaseCache() *mergeBaseCache {
	return &mergeBaseCache{byKey: make(map[mergeBaseCacheKey]mergeBaseCacheValue)}
}

func (c *mergeBaseCache) get(base, branch string) (mergeBaseCacheValue, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := mergeBaseCacheKey{base, branch}
	v, ok := c.byKey[key]
	if !ok {
		return mergeBaseCacheValue{}, false
	}
	c.touchLocked(key)
	return v, true
}

func (c *mergeBaseCache) set(base, branch string, v mergeBaseCacheValue) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := mergeBaseCacheKey{base, branch}
	if _, exists := c.byKey[key]; exists {
		c.removeFromOrderLocked(key)
	}
	c.byKey[key] = v
	c.order = append(c.order, key)
	for len(c.order) > mergeBaseCacheCap {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.byKey, oldest)
	}
}

// dropAll evicts every entry — called on refsChanged and by invalidateAfterWrite, mirroring
// detailCache/refsCache/stackCache's own ordering (entry.go's note, before the fan-out).
func (c *mergeBaseCache) dropAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = nil
	c.byKey = make(map[mergeBaseCacheKey]mergeBaseCacheValue)
}

func (c *mergeBaseCache) touchLocked(key mergeBaseCacheKey) {
	c.removeFromOrderLocked(key)
	c.order = append(c.order, key)
}

func (c *mergeBaseCache) removeFromOrderLocked(key mergeBaseCacheKey) {
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
//
// G30 round-1 performance review, finding #9: `order` used to be a plain `[]diffCacheKey`, so
// every touch-on-get and every re-set of an already-cached key did a linear scan
// (removeFromOrderLocked) to find and splice the key out before re-appending it — O(n) per access
// against a cache with no entry-count cap at all (only a 4 MiB byte budget, D7's own choice,
// which a repository with many small-patch files can hold thousands of entries under). `order` is
// now a `container/list.List` (front = least-recently-used, back = most-recently-used) plus an
// `elems` index from key to `*list.Element`, giving touch/remove both O(1): `MoveToBack` and
// `Remove` are pointer operations on the list's own doubly-linked nodes, never a scan.
type diffCache struct {
	mu       sync.Mutex
	capacity int64
	total    int64
	order    *list.List // Value: diffCacheKey. Front = least-recently-used, back = most-recently-used.
	elems    map[diffCacheKey]*list.Element
	byKey    map[diffCacheKey]diffCacheEntry
}

func newDiffCache(capacityBytes int64) *diffCache {
	return &diffCache{
		capacity: capacityBytes,
		order:    list.New(),
		elems:    make(map[diffCacheKey]*list.Element),
		byKey:    make(map[diffCacheKey]diffCacheEntry),
	}
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
	c.elems[key] = c.order.PushBack(key)
	c.total += bytes
	for c.total > c.capacity && c.order.Len() > 0 {
		front := c.order.Front()
		oldest := front.Value.(diffCacheKey)
		c.order.Remove(front)
		delete(c.elems, oldest)
		c.total -= c.byKey[oldest].bytes
		delete(c.byKey, oldest)
	}
}

// clear drops every entry — called from RepoEntry.teardown alongside the detail cache, for
// symmetry (the entry itself is being destroyed either way, so this is not load-bearing).
func (c *diffCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.order = list.New()
	c.elems = make(map[diffCacheKey]*list.Element)
	c.total = 0
	c.byKey = make(map[diffCacheKey]diffCacheEntry)
}

func (c *diffCache) touchLocked(key diffCacheKey) {
	if elem, ok := c.elems[key]; ok {
		c.order.MoveToBack(elem)
	}
}

func (c *diffCache) removeFromOrderLocked(key diffCacheKey) {
	if elem, ok := c.elems[key]; ok {
		c.order.Remove(elem)
		delete(c.elems, key)
	}
}
