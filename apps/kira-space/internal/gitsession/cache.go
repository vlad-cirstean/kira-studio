package gitsession

import (
	"container/list"
	"sync"

	lru "github.com/hashicorp/golang-lru/v2"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
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
// entries a given ref move actually touched. Backed by golang-lru (P113 G9, library-first over a
// hand-rolled slice-based LRU) — its Cache[K, V] is safe for concurrent use on its own, so no
// wrapper mutex is needed here.
type detailCache struct {
	c *lru.Cache[detailCacheKey, porcelain.CommitDetail]
}

func newDetailCache() *detailCache {
	c, _ := lru.New[detailCacheKey, porcelain.CommitDetail](detailCacheCap) // only errs on size <= 0
	return &detailCache{c: c}
}

func (c *detailCache) get(sha string, parentIndex int) (porcelain.CommitDetail, bool) {
	return c.c.Get(detailCacheKey{sha, parentIndex})
}

func (c *detailCache) set(sha string, parentIndex int, v porcelain.CommitDetail) {
	c.c.Add(detailCacheKey{sha, parentIndex}, v)
}

// dropAll evicts every entry — called on refsChanged, before the fan-out (entry.go's note),
// mirroring G3 D13's ordering rule for marking a Walk stale.
func (c *detailCache) dropAll() {
	c.c.Purge()
}

// valueCache is refsCache/stackCache's own shared shape (P113 G9): one repository, one cached
// value — refs.list and stack.list each have exactly one answer per repository, never many, so no
// LRU is needed here, unlike detailCache/diffCache. Dropped whole on refsChanged, before the
// fan-out (entry.go's note), the same ordering G4 D7 established for the detail cache. Pre-flight
// and the write executor never read either (D10/F16): a decision that precedes a write always
// takes a fresh snapshot.
type valueCache[T any] struct {
	mu    sync.Mutex
	value T
	valid bool
}

func newValueCache[T any]() *valueCache[T] { return &valueCache[T]{} }

func (c *valueCache[T]) get() (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.valid {
		var zero T
		return zero, false
	}
	return c.value, true
}

func (c *valueCache[T]) set(v T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value = v
	c.valid = true
}

func (c *valueCache[T]) drop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	var zero T
	c.value = zero
	c.valid = false
}

// refsCache is refs.list's own single-value cache (D10) — see valueCache's own doc comment.
type refsCache = valueCache[RefsResult]

func newRefsCache() *refsCache { return newValueCache[RefsResult]() }

// stackCache is stack.list's own single-value cache (G26 D3/D16) — see valueCache's own doc
// comment.
type stackCache = valueCache[gitpreflight.StackListResult]

func newStackCache() *stackCache { return newValueCache[gitpreflight.StackListResult]() }

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
// mergeBaseCacheCap entries (plain LRU by entry count). Backed by golang-lru, same as detailCache
// (P113 G9).
type mergeBaseCache struct {
	c *lru.Cache[mergeBaseCacheKey, mergeBaseCacheValue]
}

func newMergeBaseCache() *mergeBaseCache {
	c, _ := lru.New[mergeBaseCacheKey, mergeBaseCacheValue](mergeBaseCacheCap) // only errs on size <= 0
	return &mergeBaseCache{c: c}
}

func (c *mergeBaseCache) get(base, branch string) (mergeBaseCacheValue, bool) {
	return c.c.Get(mergeBaseCacheKey{base, branch})
}

func (c *mergeBaseCache) set(base, branch string, v mergeBaseCacheValue) {
	c.c.Add(mergeBaseCacheKey{base, branch}, v)
}

// dropAll evicts every entry — called on refsChanged and by invalidateAfterWrite, mirroring
// detailCache/refsCache/stackCache's own ordering (entry.go's note, before the fan-out).
func (c *mergeBaseCache) dropAll() {
	c.c.Purge()
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
