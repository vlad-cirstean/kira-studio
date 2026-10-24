package agentsandbox

import (
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/packages/theme/src/i18n"
)

// Tracker collects one run's denials: the first MaxDenials distinct (op, target) pairs and a total.
type Tracker struct {
	mu       sync.Mutex
	distinct []Denial
	total    int
}

// Add records d and reports whether it is a new distinct denial kept in the list.
func (t *Tracker) Add(d Denial) (fresh bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.total++
	if d.Count != 1 || len(t.distinct) >= MaxDenials {
		return false
	}
	t.distinct = append(t.distinct, d)
	return true
}

// Snapshot returns the kept denials and the total count.
func (t *Tracker) Snapshot() ([]Denial, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Denial(nil), t.distinct...), t.total
}

// First returns the first denial, if any.
func (t *Tracker) First() (Denial, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.distinct) == 0 {
		return Denial{}, false
	}
	return t.distinct[0], true
}

// BlockedReason prefixes reason with the first denial, unless reason already names its target.
func (t *Tracker) BlockedReason(reason string) string {
	d, ok := t.First()
	if !ok || strings.Contains(reason, d.Target) {
		return reason
	}
	msg := i18n.T("backend.space.ade.sandbox.blocked.body", map[string]string{"op": d.Op, "target": d.Target})
	if reason == "" {
		return msg
	}
	return msg + " " + reason
}
