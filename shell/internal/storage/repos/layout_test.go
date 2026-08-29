package repos_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestLayoutGetAllDefaults(t *testing.T) {
	r := newLayoutRepo(t)
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if diff := cmp.Diff(model.DefaultLayout(), got); diff != "" {
		t.Errorf("GetAll() on empty db (-want +got):\n%s", diff)
	}
}

func TestLayoutSetWritesAllLeaves(t *testing.T) {
	r := newLayoutRepo(t)
	if _, err := r.Set(model.LayoutPatch{
		Panel: &model.PanelsPatch{CellEditor: &model.PanelCellEditorPatch{Height: ptrTo(999.0)}},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	var count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM ui_layout`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	// Unlike SettingsRepo.Set, LayoutRepo.Set writes all six leaves every time (P53 §4.5's
	// deliberate difference), mirroring layout.ts's flatten(merged).
	if count != 6 {
		t.Errorf("ui_layout row count after one-field Set = %d, want 6", count)
	}
}

func TestLayoutWindowBoundsRoundTrip(t *testing.T) {
	r := newLayoutRepo(t)
	bounds := &model.WindowBounds{X: 1, Y: 2, Width: 800, Height: 600}
	got, err := r.Set(model.LayoutPatch{Window: &model.WindowPatch{Bounds: bounds}})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if diff := cmp.Diff(bounds, got.Window.Bounds); diff != "" {
		t.Errorf("Window.Bounds after Set (-want +got):\n%s", diff)
	}

	got2, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if diff := cmp.Diff(bounds, got2.Window.Bounds); diff != "" {
		t.Errorf("Window.Bounds after GetAll (-want +got):\n%s", diff)
	}
}

func TestLayoutWindowBoundsDefaultsToNil(t *testing.T) {
	r := newLayoutRepo(t)
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if got.Window.Bounds != nil {
		t.Errorf("Window.Bounds on empty db = %+v, want nil", got.Window.Bounds)
	}
}

func TestLayoutGetAllDropsUnparseableLeaf(t *testing.T) {
	r := newLayoutRepo(t)
	if _, err := r.DB.Exec(`INSERT INTO ui_layout (key, value) VALUES ('panel.project.width', 'not json')`); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if diff := cmp.Diff(model.DefaultLayout(), got); diff != "" {
		t.Errorf("GetAll() with unparseable leaf (-want default +got):\n%s", diff)
	}
}
