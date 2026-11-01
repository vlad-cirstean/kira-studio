package shell_test

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/internal/shell"
)

type fakeShortcuts struct {
	held   map[string]bool
	taken  map[string]bool
	unregs int
}

func (f *fakeShortcuts) Register(accel string, _ func()) error {
	if f.taken[accel] {
		return errors.New("taken")
	}
	f.held[accel] = true
	return nil
}

func (f *fakeShortcuts) Unregister(accel string) error {
	f.unregs++
	delete(f.held, accel)
	return nil
}

func TestHotkeyApplyKeepsOldChordOnFailure(t *testing.T) {
	f := &fakeShortcuts{held: map[string]bool{}, taken: map[string]bool{"Ctrl+B": true}}
	b := shell.NewHotkeyBinding(f, func() bool { return false })
	if st := b.Apply(true, "Ctrl+A", nil); st.State != shell.HotkeyActive {
		t.Fatalf("first apply = %+v", st)
	}
	st := b.Apply(true, "Ctrl+B", nil)
	if st.State != shell.HotkeyFailed || st.Accelerator != "Ctrl+B" {
		t.Fatalf("failed apply = %+v", st)
	}
	if !f.held["Ctrl+A"] {
		t.Fatal("old chord dropped")
	}
	if st := b.Apply(true, "Ctrl+A", nil); st.State != shell.HotkeyActive || f.unregs != 0 {
		t.Fatalf("reapply = %+v, unregs %d", st, f.unregs)
	}
	f.taken["Ctrl+B"] = false
	b.Apply(true, "Ctrl+B", nil)
	if f.held["Ctrl+A"] || !f.held["Ctrl+B"] {
		t.Fatalf("held = %v", f.held)
	}
}
