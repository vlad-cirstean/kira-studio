package shell_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/shell"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func newLayoutRepo(t *testing.T) *repos.LayoutRepo {
	t.Helper()
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return &repos.LayoutRepo{DB: db.DB}
}

func TestOptionsWithNoStoredBoundsUsesWailsDefaults(t *testing.T) {
	d := shell.WindowDeps{Layout: newLayoutRepo(t)}
	opts := shell.Options(d, shell.Harden(), "http://localhost/")

	if opts.Width != 1280 || opts.Height != 800 {
		t.Errorf("Width/Height = %d/%d, want 1280/800", opts.Width, opts.Height)
	}
	if opts.X != 0 || opts.Y != 0 {
		t.Errorf("X/Y = %d/%d, want 0/0 (Wails' own default position, InitialPosition left unset)", opts.X, opts.Y)
	}
	if opts.InitialPosition != application.WindowCentered {
		t.Errorf("InitialPosition = %v, want the zero value (WindowCentered)", opts.InitialPosition)
	}
}

func TestOptionsWithStoredBoundsUsesTheStoredRectangle(t *testing.T) {
	layout := newLayoutRepo(t)
	stored := model.WindowBounds{X: -10, Y: 5, Width: 1500, Height: 900}
	if _, err := layout.Set(model.LayoutPatch{Window: &model.WindowPatch{Bounds: &stored}}); err != nil {
		t.Fatalf("layout.Set: %v", err)
	}

	opts := shell.Options(shell.WindowDeps{Layout: layout}, shell.Harden(), "http://localhost/")

	if opts.Width != 1500 || opts.Height != 900 {
		t.Errorf("Width/Height = %d/%d, want 1500/900", opts.Width, opts.Height)
	}
	if opts.X != -10 {
		t.Errorf("X = %d, want -10 (a stored negative X must survive the int64->int conversion)", opts.X)
	}
	if opts.Y != 5 {
		t.Errorf("Y = %d, want 5", opts.Y)
	}
	if opts.InitialPosition != application.WindowXY {
		t.Errorf("InitialPosition = %v, want application.WindowXY", opts.InitialPosition)
	}
}

// TestPersistWriteShapeRoundTripsThroughLayoutRepo drives the exact LayoutPatch shape
// Attach's persist closure builds (window.go) directly against a real LayoutRepo, without a
// live *application.WebviewWindow (headless CI has none) — the same write, read back through
// GetAll.
func TestPersistWriteShapeRoundTripsThroughLayoutRepo(t *testing.T) {
	layout := newLayoutRepo(t)
	bounds := model.WindowBounds{X: -42, Y: 7, Width: 1024, Height: 640}

	if _, err := layout.Set(model.LayoutPatch{Window: &model.WindowPatch{Bounds: &bounds}}); err != nil {
		t.Fatalf("layout.Set: %v", err)
	}

	got, err := layout.GetAll()
	if err != nil {
		t.Fatalf("layout.GetAll: %v", err)
	}
	if got.Window.Bounds == nil {
		t.Fatal("Window.Bounds is nil after persisting a rectangle")
	}
	if *got.Window.Bounds != bounds {
		t.Errorf("Window.Bounds = %+v, want %+v", *got.Window.Bounds, bounds)
	}
}
