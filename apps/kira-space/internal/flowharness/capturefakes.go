package flowharness

import (
	"fmt"
	"slices"
	"sync"
	"testing"
)

// Clipboard fakes the system clipboard text.
type Clipboard struct {
	mu    sync.Mutex
	text  string
	has   bool
	reads int
}

// SetText puts text on the clipboard.
func (c *Clipboard) SetText(s string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.text, c.has = s, true
}

// SetEmpty leaves nothing (or non-text content) on the clipboard.
func (c *Clipboard) SetEmpty() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.text, c.has = "", false
}

// Text is the app's read; it counts reads.
func (c *Clipboard) Text() (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reads++
	return c.text, c.has
}

// Reads is how many times the app read the clipboard.
func (c *Clipboard) Reads() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reads
}

// Shortcuts fakes Wails' global shortcut manager: it records registrations and runs a callback when a
// test fires its accelerator.
type Shortcuts struct {
	mu        sync.Mutex
	callbacks map[string]func()
	failNext  error
	registers int
}

func newShortcuts() *Shortcuts { return &Shortcuts{callbacks: map[string]func(){}} }

// reset forgets every registration, as a relaunched process starts with none.
func (s *Shortcuts) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.callbacks, s.failNext, s.registers = map[string]func(){}, nil, 0
}

func (s *Shortcuts) Register(accel string, cb func()) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registers++
	if err := s.failNext; err != nil {
		s.failNext = nil
		return err
	}
	if _, ok := s.callbacks[accel]; ok {
		return fmt.Errorf("global shortcut %q is already registered", accel)
	}
	s.callbacks[accel] = cb
	return nil
}

func (s *Shortcuts) Unregister(accel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.callbacks[accel]; !ok {
		return fmt.Errorf("global shortcut %q is not registered", accel)
	}
	delete(s.callbacks, accel)
	return nil
}

// FailNext makes the next Register return err.
func (s *Shortcuts) FailNext(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failNext = err
}

// Registered lists the registered accelerators, sorted.
func (s *Shortcuts) Registered() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.callbacks))
	for a := range s.callbacks {
		out = append(out, a)
	}
	slices.Sort(out)
	return out
}

// Registers is how many Register calls the app made, failed ones included.
func (s *Shortcuts) Registers() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registers
}

// Fire runs accel's callback synchronously, as the OS hotkey press does; the test fails when nothing
// is registered there.
func (s *Shortcuts) Fire(t testing.TB, accel string) {
	t.Helper()
	s.mu.Lock()
	cb := s.callbacks[accel]
	s.mu.Unlock()
	if cb == nil {
		t.Fatalf("Fire(%q): not registered (have %v)", accel, s.Registered())
	}
	cb()
}
