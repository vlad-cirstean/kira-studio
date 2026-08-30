package bridge_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestLayoutSetRoundTrip(t *testing.T) {
	deps, _, _ := newTestDeps(t)
	svc := &bridge.LayoutService{Deps: deps}

	bounds := model.WindowBounds{X: 10, Y: 20, Width: 1280, Height: 800}
	afterBounds, err := svc.Set(bridge.LayoutSetArgs{
		Patch: model.LayoutPatch{Window: &model.WindowPatch{Bounds: &bounds}},
	})
	if err != nil {
		t.Fatalf("Set (bounds): %v", err)
	}
	if got, err := svc.GetAll(); err != nil || got.Window.Bounds == nil || *got.Window.Bounds != bounds {
		t.Errorf("GetAll after bounds patch = %+v, %v, want bounds %+v", got, err, bounds)
	}
	if diff := cmp.Diff(afterBounds, mustGetAll(t, svc)); diff != "" {
		t.Errorf("Set()'s return differs from a fresh GetAll() (-GetAll +Set):\n%s", diff)
	}

	visible := false
	width := 300.0
	afterPanel, err := svc.Set(bridge.LayoutSetArgs{
		Patch: model.LayoutPatch{Panel: &model.PanelsPatch{Project: &model.PanelProjectPatch{Visible: &visible, Width: &width}}},
	})
	if err != nil {
		t.Fatalf("Set (panel): %v", err)
	}
	if afterPanel.Panel.Project.Visible != false || afterPanel.Panel.Project.Width != 300 {
		t.Errorf("Panel.Project = %+v, want {Visible:false Width:300}", afterPanel.Panel.Project)
	}
	// The earlier bounds patch must survive an unrelated panel patch (Set merges, not replaces).
	if afterPanel.Window.Bounds == nil || *afterPanel.Window.Bounds != bounds {
		t.Errorf("Window.Bounds after an unrelated panel patch = %v, want %+v (unchanged)", afterPanel.Window.Bounds, bounds)
	}

	before := afterPanel
	after, err := svc.Set(bridge.LayoutSetArgs{Patch: model.LayoutPatch{}})
	if err != nil {
		t.Fatalf("Set (empty patch): %v", err)
	}
	if diff := cmp.Diff(before, after); diff != "" {
		t.Errorf("an empty patch changed the layout (-before +after):\n%s", diff)
	}
}

func mustGetAll(t *testing.T, svc *bridge.LayoutService) model.Layout {
	t.Helper()
	got, err := svc.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	return got
}
