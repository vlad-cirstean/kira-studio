package shell

import (
	"slices"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type fakeFocuser struct{ calls *[]string }

func (f fakeFocuser) Show() application.Window { *f.calls = append(*f.calls, "show"); return nil }
func (f fakeFocuser) UnMinimise()              { *f.calls = append(*f.calls, "unminimise") }
func (f fakeFocuser) Focus()                   { *f.calls = append(*f.calls, "focus") }

// P354 crash guard: App-level unhide ([NSApp unhide:]) aborts the process off the main thread, so
// raise must run it inside the main-thread dispatcher and before the window calls.
func TestRaiseUnhidesOnMainThreadBeforeWindowCalls(t *testing.T) {
	var calls []string
	onMain := false
	dispatch := func(fn func()) {
		onMain = true
		defer func() { onMain = false }()
		fn()
	}
	unhide := func() {
		if !onMain {
			t.Error("unhide ran off the main-thread dispatcher")
		}
		calls = append(calls, "unhide")
	}
	raise(dispatch, unhide, fakeFocuser{&calls})
	if want := []string{"unhide", "show", "unminimise", "focus"}; !slices.Equal(calls, want) {
		t.Fatalf("call order = %v, want %v", calls, want)
	}
}
