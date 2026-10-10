// Package gitcred holds every git credential prompt until a Kira Space window answers it (P178 D2,
// P246 D13): the ADE board's carry no origin window, a native stream's carry the window it serves.
package gitcred

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/internal/notify"
	"github.com/kirathecat/kira-studio/internal/prompts"
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
	// Origin is the window key the git op came from; "" for a background op.
	Origin string `json:"origin"`
}

// Snapshot is every pending prompt, oldest first.
type Snapshot = []Prompt

type entry struct {
	prompt Prompt
	answer chan string // buffered 1; at most one send or close over the entry's lifetime.
}

// Relay is a FIFO of pending prompts fanned out as ordered snapshots (notify.OrderedEmitter).
type Relay struct {
	// Prompts routes each pending prompt to a window and an OS notification (P246); nil routes none.
	Prompts prompts.Sink

	mu      sync.Mutex
	queue   *notify.PendingQueue[*entry]
	emitter notify.OrderedEmitter[Snapshot]
}

func New() *Relay {
	return &Relay{queue: notify.NewPendingQueue[*entry]()}
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

// Ask is AskFrom for a prompt with no origin window.
func (r *Relay) Ask(ctx context.Context, source string, req gitaskpass.Request) (string, bool) {
	return r.AskFrom(ctx, "", source, req)
}

// AskFrom enqueues req, publishes it and blocks until a window answers or ctx ends. origin is the
// window the git op came from, "" for none. It returns ("", false) for every unanswered outcome
// (gitaskpass.Prompter's contract). Every exit removes the entry and publishes, so every window
// closes a stale dialog.
func (r *Relay) AskFrom(ctx context.Context, origin, source string, req gitaskpass.Request) (string, bool) {
	e := &entry{
		prompt: Prompt{
			RequestID: newRequestID(), Source: source, RepoLabel: req.RepoLabel,
			Prompt: req.Prompt, Masked: req.Masked, Origin: origin,
		},
		answer: make(chan string, 1),
	}
	id := e.prompt.RequestID

	r.mu.Lock()
	r.queue.Add(id, e)
	// Under mu so a fast answer cannot Close before this Open.
	r.openPromptLocked(e.prompt)
	seq, snap := r.emitter.NextSeq(), r.snapshotLocked()
	r.mu.Unlock()
	r.emitter.Emit(seq, snap)

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
	r.closePromptLocked(id)
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
	r.closePromptLocked(requestID)
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

// openPromptLocked registers the prompt with the router. The title carries the repository only,
// never the prompt text.
func (r *Relay) openPromptLocked(p Prompt) {
	if r.Prompts == nil {
		return
	}
	title := "Git needs a credential"
	if p.RepoLabel != "" {
		title += " · " + p.RepoLabel
	}
	r.Prompts.Open(prompts.Prompt{
		ID: prompts.ID(prompts.KindGitCredential, p.RequestID), Kind: prompts.KindGitCredential,
		Ref: p.RequestID, Origin: p.Origin, Title: title,
	})
}

func (r *Relay) closePromptLocked(requestID string) {
	if r.Prompts != nil {
		r.Prompts.Close(prompts.ID(prompts.KindGitCredential, requestID))
	}
}
