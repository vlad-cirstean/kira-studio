// Package notify is a small generic pub-sub emitter, replacing the Set<handler>/on(cb)=>unsubscribe
// idiom src/main/connections.ts, preconnect.ts and oplog.ts each hand-roll (P55 §2 D1).
package notify

import "sync"

// Emitter fans a value out to every current subscriber. The zero value is ready to use.
type Emitter[T any] struct {
	mu     sync.Mutex
	nextID uint64
	subs   map[uint64]func(T)
}

// Subscribe registers fn and returns its unsubscribe func. Every subscriber receives every
// value emitted after it subscribes.
func (e *Emitter[T]) Subscribe(fn func(T)) (unsubscribe func()) {
	e.mu.Lock()
	if e.subs == nil {
		e.subs = make(map[uint64]func(T))
	}
	id := e.nextID
	e.nextID++
	e.subs[id] = fn
	e.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			e.mu.Lock()
			delete(e.subs, id)
			e.mu.Unlock()
		})
	}
}

// Emit snapshots the current subscriber list under the lock and calls each callback with the
// lock released, so a callback that subscribes, unsubscribes or emits re-entrantly cannot
// deadlock — the exact class of bug P54 §1.2 found three of in enginehost's own concurrency.
// Callers must likewise never hold their own service mutex across a call to Emit.
func (e *Emitter[T]) Emit(v T) {
	e.mu.Lock()
	snapshot := make([]func(T), 0, len(e.subs))
	for _, fn := range e.subs {
		snapshot = append(snapshot, fn)
	}
	e.mu.Unlock()

	for _, fn := range snapshot {
		fn(v)
	}
}
