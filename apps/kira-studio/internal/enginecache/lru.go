// Package enginecache is the Go analogue of src/engine/cache/: L2 (result pages) and L3 (row
// counts) only — L1 (metadata) lives in apps/kira-studio/internal/storage's SQLite repos so the tree renders
// while disconnected, the same reason P1 D10 kept it out of the TypeScript engine.
//
// Unlike cache/{pages,counts}.ts's process-global singletons, Cache is a value constructed once by
// main.go and held by the router: a package-level singleton would be untestable in a `go test`
// binary that runs every case in one process (the TypeScript spec has to call clearPages() between
// cases for exactly this reason).
package enginecache

import (
	"container/list"
	"time"
)

// EntryMeta is lru.ts's ByteLruEntryMeta.
type EntryMeta struct {
	ConnectionID string
	Path         string
	Label        string
}

type lruEntry[V any] struct {
	key   string
	value V
	bytes int
	at    time.Time
	meta  EntryMeta
}

// LruEntry is one row of a ByteLru snapshot, returned by Entries().
type LruEntry[V any] struct {
	Key   string
	Value V
	Bytes int
	At    time.Time
	Meta  EntryMeta
}

// ByteLru is the Go analogue of lru.ts's ByteLru<V>: a byte-budgeted LRU. JS backs it with a Map,
// whose insertion order gives LRU ordering for free; Go maps have no order, so this is the standard
// map[string]*list.Element + container/list shape instead (P58 D9). Not internally synchronized —
// same as the TypeScript, which never needed to be; Cache's own mutex is what makes the whole
// enginecache package safe to share across goroutines.
type ByteLru[V any] struct {
	budget int
	total  int
	order  *list.List // front = oldest, back = newest
	items  map[string]*list.Element
	warn   func(msg string)
}

// NewByteLru constructs a ByteLru with budgetBytes and an optional half-budget-refusal logger.
func NewByteLru[V any](budgetBytes int, warn func(msg string)) *ByteLru[V] {
	if warn == nil {
		warn = func(string) {}
	}
	return &ByteLru[V]{budget: budgetBytes, order: list.New(), items: make(map[string]*list.Element), warn: warn}
}

func (l *ByteLru[V]) BudgetBytes() int { return l.budget }
func (l *ByteLru[V]) Bytes() int       { return l.total }
func (l *ByteLru[V]) Size() int        { return len(l.items) }

// SetBudget mirrors ByteLru.setBudget: lowering the budget evicts immediately.
func (l *ByteLru[V]) SetBudget(bytes int) {
	l.budget = bytes
	l.evictToBudget()
}

// Get mirrors ByteLru.get: a hit touches the entry, moving it to the newest end.
func (l *ByteLru[V]) Get(key string) (V, bool) {
	el, ok := l.items[key]
	if !ok {
		var zero V
		return zero, false
	}
	l.order.MoveToBack(el)
	return el.Value.(*lruEntry[V]).value, true
}

// Set mirrors ByteLru.set, including the half-budget refusal: an entry larger than half the budget
// is not stored at all ("one 40 MB page must not evict every other page in a 64 MB budget").
func (l *ByteLru[V]) Set(key string, value V, bytes int, meta EntryMeta) {
	if bytes > l.budget/2 {
		l.warn(warnMessage(meta.Label, bytes, l.budget))
		return
	}
	if existing, ok := l.items[key]; ok {
		l.total -= existing.Value.(*lruEntry[V]).bytes
		l.order.Remove(existing)
		delete(l.items, key)
	}
	el := l.order.PushBack(&lruEntry[V]{key: key, value: value, bytes: bytes, at: time.Now(), meta: meta})
	l.items[key] = el
	l.total += bytes
	l.evictToBudget()
}

func warnMessage(label string, bytes, budget int) string {
	return "cache: refusing to store " + label + ": " + itoa(bytes) + " bytes exceeds half the " +
		itoa(budget) + "-byte budget"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// Delete mirrors ByteLru.delete.
func (l *ByteLru[V]) Delete(key string) bool {
	el, ok := l.items[key]
	if !ok {
		return false
	}
	l.order.Remove(el)
	delete(l.items, key)
	l.total -= el.Value.(*lruEntry[V]).bytes
	return true
}

// DeleteWhere mirrors ByteLru.deleteWhere.
func (l *ByteLru[V]) DeleteWhere(pred func(EntryMeta) bool) int {
	removed := 0
	for el := l.order.Front(); el != nil; {
		next := el.Next()
		entry := el.Value.(*lruEntry[V])
		if pred(entry.meta) {
			l.order.Remove(el)
			delete(l.items, entry.key)
			l.total -= entry.bytes
			removed++
		}
		el = next
	}
	return removed
}

// Clear mirrors ByteLru.clear.
func (l *ByteLru[V]) Clear() {
	l.order.Init()
	l.items = make(map[string]*list.Element)
	l.total = 0
}

// Entries mirrors ByteLru.entries: a snapshot, oldest first.
func (l *ByteLru[V]) Entries() []LruEntry[V] {
	out := make([]LruEntry[V], 0, l.order.Len())
	for el := l.order.Front(); el != nil; el = el.Next() {
		e := el.Value.(*lruEntry[V])
		out = append(out, LruEntry[V]{Key: e.key, Value: e.value, Bytes: e.bytes, At: e.at, Meta: e.meta})
	}
	return out
}

func (l *ByteLru[V]) evictToBudget() {
	for l.total > l.budget {
		front := l.order.Front()
		if front == nil {
			break
		}
		entry := front.Value.(*lruEntry[V])
		l.order.Remove(front)
		delete(l.items, entry.key)
		l.total -= entry.bytes
	}
}
