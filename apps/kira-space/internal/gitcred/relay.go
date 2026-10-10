// Package gitcred holds git credential prompts that have no window of their own — the ADE
// board's (ADE) — until a Kira Space window answers them (P178 D2). The
// native git stream keeps its own per-workspace path: its prompt always has a window.
package gitcred

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/internal/notify"
)

// Prompt is one pending prompt as a window renders it. Never logged: Prompt can carry a username
// the user just typed (gitaskpass.Request's own rule).
type Prompt struct {
	RequestID string `json:"requestId"`
	// Source is the asking connection's client label.
	Source    string `json:"source"`
	RepoLabel string `json:"repoLabel"`
	Prompt    string `json:"prompt"`
	Masked    bool   `json:"masked"`
}

// Snapshot is every pending prompt, oldest first.
type Snapshot = []Prompt

type entry struct {
	prompt Prompt
	answer chan string // buffered 1; at most one send or close over the entry's lifetime.
}

// Relay is a FIFO of pending prompts fanned out as ordered snapshots (notify.OrderedEmitter).
type Relay struct {
	mu      sync.Mutex
	queue   *notify.PendingQueue[*entry]
	onAdded func()
	emitter notify.OrderedEmitter[Snapshot]
}

func New() *Relay {
	return &Relay{queue: notify.NewPendingQueue[*entry]()}
}

// SetOnAdded installs the callback run after each prompt is enqueued and published. It may run
// concurrently with Ask.
func (r *Relay) SetOnAdded(fn func()) {
	r.mu.Lock()
	r.onAdded = fn
	r.mu.Unlock()
}

func (r *Relay) Subscribe(fn func(Snapshot)) (unsubscribe func()) {
	return r.emitter.Subscribe(fn)
}

// Pending is the snapshot a newly opened window fetches on mount.
func (r *Relay) Pending() Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked()
}

func (r *Relay) snapshotLocked() Snapshot {
	items := r.queue.Snapshot()
	out := make(Snapshot, 0, len(items))
	for _, e := range items {
		out = append(out, e.prompt)
	}
	return out
}

func newRequestID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf) // crypto/rand.Read never errors on a Reader that never fails to fill.
	return hex.EncodeToString(buf)
}

// Ask enqueues req, publishes it and blocks until a window answers or ctx ends. It returns
// ("", false) for every unanswered outcome (gitaskpass.Prompter's contract). Every exit removes
// the entry and publishes, so every window closes a stale dialog.
func (r *Relay) Ask(ctx context.Context, source string, req gitaskpass.Request) (string, bool) {
	e := &entry{
		prompt: Prompt{
			RequestID: newRequestID(), Source: source, RepoLabel: req.RepoLabel,
			Prompt: req.Prompt, Masked: req.Masked,
		},
		answer: make(chan string, 1),
	}
	id := e.prompt.RequestID

	r.mu.Lock()
	r.queue.Add(id, e)
	seq, snap, onAdded := r.emitter.NextSeq(), r.snapshotLocked(), r.onAdded
	r.mu.Unlock()
	r.emitter.Emit(seq, snap)
	if onAdded != nil {
		onAdded()
	}

	select {
	case secret, ok := <-e.answer:
		if !ok || secret == "" {
			return "", false
		}
		return secret, true
	case <-ctx.Done():
		r.withdraw(id)
		return "", false
	}
}

func (r *Relay) withdraw(id string) {
	r.mu.Lock()
	_, ok := r.queue.Remove(id)
	seq, snap := r.emitter.NextSeq(), r.snapshotLocked()
	r.mu.Unlock()
	if ok {
		r.emitter.Emit(seq, snap)
	}
}

// Provide answers requestID with secret (nil dismisses). The entry leaves the queue under the lock
// before its channel is touched, so a second answer, or an id nothing is waiting on, finds nothing
// and reports false, never an error.
func (r *Relay) Provide(requestID string, secret *string) bool {
	r.mu.Lock()
	e, ok := r.queue.Remove(requestID)
	seq, snap := r.emitter.NextSeq(), r.snapshotLocked()
	r.mu.Unlock()
	if !ok {
		return false
	}
	r.emitter.Emit(seq, snap)
	if secret == nil {
		close(e.answer)
	} else {
		e.answer <- *secret
	}
	return true
}
