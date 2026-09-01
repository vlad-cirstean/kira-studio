package shell_test

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// newAttachedWindow builds a real *repos.WindowsRepo on a temp DB (0002_p8_windows.sql's
// migration seeds the "main" row every fresh database gets, so Attach's SetBounds("main", …) has
// a row to update with no manual seeding here) and a real, display-less
// *application.WebviewWindow (testApp never calls Run(), so its impl stays nil). HandleWindowEvent
// still dispatches to registered listeners the same way a real resize/move would — WindowClosing is
// the one event this can't safely exercise here: Wails registers its own internal WindowClosing
// listener on every window (webview_window.go's NewWindow) that calls InvokeSync against the main
// thread dispatcher app.Run() would normally be pumping, which panics once nothing is pumping it,
// regardless of anything this package does.
func newAttachedWindow(t *testing.T) (*application.WebviewWindow, *repos.WindowsRepo) {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	r, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	win := testApp.Window.NewWithOptions(application.WebviewWindowOptions{})
	return win, r.Windows
}

// sentinelBounds lets a test tell "persist() ran and overwrote this" apart from "persist() never
// ran": win.Bounds() always reports the zero Rect{} in these tests (no native window backs it), so
// two persisted writes are otherwise indistinguishable by value.
var sentinelBounds = &model.WindowBounds{X: 111, Y: 222, Width: 333, Height: 444}

// boundsOf finds the "main" record's stored bounds among windows' List() result — nil if the
// window has never persisted a rectangle.
func boundsOf(t *testing.T, windows *repos.WindowsRepo) *model.WindowBounds {
	t.Helper()
	records, err := windows.List()
	if err != nil {
		t.Fatalf("Windows.List: %v", err)
	}
	for _, rec := range records {
		if rec.Key == "main" {
			return rec.Bounds
		}
	}
	t.Fatal(`Windows.List() has no "main" record — 0002_p8_windows.sql should have seeded one`)
	return nil
}

// TestAttach_PersistsResizeAfterDebounce is the positive control for the regression test below: it
// proves a resize dispatched to an attached window really does reach persist() after the debounce
// window, so TestAttach_DetachStopsPersisting's negative assertion means what it claims.
func TestAttach_PersistsResizeAfterDebounce(t *testing.T) {
	win, windows := newAttachedWindow(t)
	shell.Attach(win, shell.WindowDeps{Windows: windows, StartedAt: time.Now()})

	win.HandleWindowEvent(uint(events.Common.WindowDidResize))
	time.Sleep(500 * time.Millisecond)

	if boundsOf(t, windows) == nil {
		t.Fatal("resize on an attached window was never persisted")
	}
}

// TestAttach_DetachStopsPersisting covers the half of the P2 R1 fix that a unit test actually can:
// main.go used to discard shell.Attach's returned detach entirely, instead of wiring it into
// beforeFlush the way Attach's own doc comment says it must be — a resize or move landing during
// the shutdown flush-wait (after beforeFlush runs but before teardown closes the DB) could still
// fire persist() against a LayoutRepo whose DB was mid-close. main.go's own wiring isn't something
// a test can exercise (there is no seam short of standing up the whole app), but the invariant it
// now relies on is: once detach runs, nothing it unsubscribed fires persist() again. This proves
// that half directly — a WindowDidResize dispatched after detach() no longer calls Layout.Set.
func TestAttach_DetachStopsPersisting(t *testing.T) {
	win, windows := newAttachedWindow(t)
	detach := shell.Attach(win, shell.WindowDeps{Windows: windows, StartedAt: time.Now()})

	detach()

	// Seed a known, distinctive value: if a stray persist() still fires, it overwrites this with
	// the zero Rect{} win.Bounds() reports in this test, revealing it even though the two values
	// are otherwise indistinguishable in this environment.
	if err := windows.SetBounds("main", *sentinelBounds); err != nil {
		t.Fatalf("Windows.SetBounds (seed): %v", err)
	}

	win.HandleWindowEvent(uint(events.Common.WindowDidResize))
	win.HandleWindowEvent(uint(events.Common.WindowDidMove))
	time.Sleep(500 * time.Millisecond)

	got := boundsOf(t, windows)
	if *got != *sentinelBounds {
		t.Fatalf("persist ran after detach: bounds = %+v, want unchanged sentinel %+v", got, sentinelBounds)
	}
}
