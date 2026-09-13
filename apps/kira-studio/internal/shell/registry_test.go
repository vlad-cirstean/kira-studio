package shell_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/shell"
)

// Real-interaction fix (item 8 — a webview process outlives its window, and duplicates on
// reopen): Count() is the new seam AttachCloseFlush reads (closeflush.go) to decide Hide() vs
// Close() for a window that's finishing its close-flush wait — `== 1` means "I am the only
// window left, closing me for real would orphan my own webview process with nothing able to
// bring it back but a brand-new one". These tests exercise Count() against Add/RemoveAndCount
// directly, the same registry entry points main.go's own openWindow call actually uses, rather
// than the *AttachCloseFlush* decision itself — RegisterHook's own dispatch calls into Wails'
// InvokeSync main-thread pump the moment any hook lets a real Close()/Hide() through
// (window_test.go's own newAttachedWindow comment: this is unsafe to exercise outside a real
// app.Run() loop, in this package's own established testing boundary, not something this fix
// works around). A nil *application.WebviewWindow is fine here — neither Add nor Count nor
// RemoveAndCount ever calls a method on the window itself; RemoveAndCount only invokes its own
// detach closure.
func TestWindowRegistry_Count(t *testing.T) {
	r := shell.NewWindowRegistry()

	if got := r.Count(); got != 0 {
		t.Fatalf("Count() on an empty registry = %d, want 0", got)
	}

	r.Add("main", nil, func() {})
	if got := r.Count(); got != 1 {
		t.Fatalf("Count() after adding one window = %d, want 1 (the case AttachCloseFlush's isLastWindow must see as true)", got)
	}

	r.Add("second", nil, func() {})
	if got := r.Count(); got != 2 {
		t.Fatalf("Count() after adding a second window = %d, want 2 (isLastWindow must see this as false for either key)", got)
	}

	// Closing a non-last window: RemoveAndCount's own return value (used by main.go's D5
	// row-deletion decision) and Count() must agree — both read the same registry.
	if remaining := r.RemoveAndCount("second"); remaining != 1 {
		t.Fatalf("RemoveAndCount(\"second\") = %d, want 1 remaining", remaining)
	}
	if got := r.Count(); got != 1 {
		t.Fatalf("Count() after removing the second window = %d, want 1", got)
	}

	// The last window closing for real (the quit path, or a Close() that already ran) empties
	// the registry — the state in which main.go's own AttachReopen is the only thing left that
	// can bring a window back, by minting a genuinely new one.
	if remaining := r.RemoveAndCount("main"); remaining != 0 {
		t.Fatalf("RemoveAndCount(\"main\") = %d, want 0 remaining", remaining)
	}
	if got := r.Count(); got != 0 {
		t.Fatalf("Count() after removing the last window = %d, want 0", got)
	}
}

// A key that was never registered (a duplicate/late WindowClosing dispatch — RemoveAndCount's
// own doc comment names this exact case) must not change Count() at all.
func TestWindowRegistry_Count_UnaffectedByRemovingAnUnknownKey(t *testing.T) {
	r := shell.NewWindowRegistry()
	r.Add("main", nil, func() {})

	if remaining := r.RemoveAndCount("never-added"); remaining != 1 {
		t.Fatalf("RemoveAndCount of an unknown key = %d, want 1 (unchanged)", remaining)
	}
	if got := r.Count(); got != 1 {
		t.Fatalf("Count() after removing an unknown key = %d, want 1 (unchanged)", got)
	}
}
