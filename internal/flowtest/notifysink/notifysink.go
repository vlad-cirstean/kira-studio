// Package notifysink is a desknotify.Sink that records what the app posted, for flow tests.
package notifysink

import (
	"sort"
	"sync"

	"github.com/kirathecat/kira-studio/internal/desknotify"
)

// Sink tracks the notifications currently shown, by id, plus every send and removal.
type Sink struct {
	mu      sync.Mutex
	shown   map[string]desknotify.Note
	sends   []desknotify.Note
	removed []string
}

// New returns an empty Sink.
func New() *Sink { return &Sink{shown: map[string]desknotify.Note{}} }

// Send records a post; a same-id post replaces the shown one.
func (s *Sink) Send(n desknotify.Note) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shown[n.ID] = n
	s.sends = append(s.sends, n)
	return nil
}

// Remove records a withdrawal.
func (s *Sink) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.shown, id)
	s.removed = append(s.removed, id)
	return nil
}

// Shown is the note currently shown under id.
func (s *Sink) Shown(id string) (desknotify.Note, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.shown[id]
	return n, ok
}

// ShownIDs lists the ids currently shown, sorted.
func (s *Sink) ShownIDs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := make([]string, 0, len(s.shown))
	for id := range s.shown {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Sends is how many posts happened, replacements included.
func (s *Sink) Sends() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sends)
}

// Removed lists the withdrawn ids in order.
func (s *Sink) Removed() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.removed...)
}
