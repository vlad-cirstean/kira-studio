// Package enginebackend exists for exactly one function: fanning adapterhost.Host's own
// op:start/op:end events together with the Node engine child's, so internal/oplog can keep
// consuming a single oplog.EventSource without ever knowing there are now two producers (A14).
// internal/oplog's own wire.go stays byte-unchanged — its consume loop is "the only reader and
// writer of inFlight, so that map needs no mutex", and a second producer calling into it directly
// is exactly how that comment gets violated.
package enginebackend

import (
	"sync"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/oplog"
)

type mergedSource struct{ a, b oplog.EventSource }

// Merge returns an oplog.EventSource whose Subscribe fans a's and b's events into one channel.
// Cost, named (A14): one json.Marshal/json.Unmarshal round trip per op-log event that
// adapterhost.Host produces, in-process — at op-log volumes (one row per user-visible operation)
// not a cost worth a mutex.
func Merge(a, b oplog.EventSource) oplog.EventSource {
	return mergedSource{a: a, b: b}
}

func (m mergedSource) Subscribe() (<-chan enginehost.Event, func()) {
	chA, unsubA := m.a.Subscribe()
	chB, unsubB := m.b.Subscribe()
	out := make(chan enginehost.Event, 64)
	done := make(chan struct{})
	var stopOnce sync.Once

	go func() {
		defer close(out)
		for chA != nil || chB != nil {
			select {
			case evt, ok := <-chA:
				if !ok {
					chA = nil
					continue
				}
				select {
				case out <- evt:
				case <-done:
					return
				}
			case evt, ok := <-chB:
				if !ok {
					chB = nil
					continue
				}
				select {
				case out <- evt:
				case <-done:
					return
				}
			}
		}
	}()

	unsubscribe := func() {
		stopOnce.Do(func() { close(done) })
		unsubA()
		unsubB()
	}
	return out, unsubscribe
}
