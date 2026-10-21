package appflow_test

import (
	"errors"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// P266: the ADE panel width is a layout leaf, patched alone, kept across a restart and range-checked.
func TestLayoutAdePanelWidth(t *testing.T) {
	app := flowharness.New(t)
	width := 480.0
	patch := model.LayoutPatch{Panel: &model.PanelsPatch{Ade: &model.PanelAdePatch{Width: &width}}}
	merged, err := app.W.Layout.Set(bridge.LayoutSetArgs{Patch: patch})
	if err != nil || merged.Panel.Ade.Width != 480 {
		t.Fatalf("Layout.Set = %+v, %v, want ade width 480", merged.Panel.Ade, err)
	}
	if got := merged.Modes["git"].Project.Width; got != 260 {
		t.Errorf("project width = %v, want the 260 default untouched", got)
	}

	app.Restart()
	got, err := app.W.Layout.GetAll()
	if err != nil || got.Panel.Ade.Width != 480 {
		t.Fatalf("Layout.GetAll after restart = %+v, %v, want ade width 480", got.Panel.Ade, err)
	}

	tooNarrow := 100.0
	bad := model.LayoutPatch{Panel: &model.PanelsPatch{Ade: &model.PanelAdePatch{Width: &tooNarrow}}}
	_, err = app.W.Layout.Set(bridge.LayoutSetArgs{Patch: bad})
	var coded *ipcerr.Error
	if !errors.As(err, &coded) || coded.Code != string(ipcerr.CodeContract) {
		t.Fatalf("Layout.Set(width 100) = %v, want %s", err, ipcerr.CodeContract)
	}
}

// P312: panel sizes are per module; a patch to one module leaves the others at their own values.
func TestLayoutPanelSizesPerModule(t *testing.T) {
	app := flowharness.New(t)
	width, height, userSet := 410.0, 310.0, true
	patch := model.LayoutPatch{Modes: map[string]model.PanelSizesPatch{
		"git": {Project: &model.ProjectSizePatch{Width: &width, WidthUserSet: &userSet}, Operations: &model.OperationsSizePatch{Height: &height}},
	}}
	merged, err := app.W.Layout.Set(bridge.LayoutSetArgs{Patch: patch})
	if err != nil || merged.Modes["git"].Project.Width != width || merged.Modes["git"].Operations.Height != height {
		t.Fatalf("Layout.Set = %+v, %v, want 410/310", merged.Modes["git"], err)
	}
	if got := merged.Modes["automations"]; got != model.DefaultPanelSizes() {
		t.Errorf("automations sizes = %+v, want the defaults untouched", got)
	}

	app.Restart()
	got, err := app.W.Layout.GetAll()
	if err != nil || got.Modes["git"].Project.Width != width || !got.Modes["git"].Project.WidthUserSet || got.Modes["automations"] != model.DefaultPanelSizes() {
		t.Fatalf("Layout.GetAll after restart = %+v, %v", got.Modes, err)
	}

	unknown := model.LayoutPatch{Modes: map[string]model.PanelSizesPatch{"bogus": {}}}
	_, err = app.W.Layout.Set(bridge.LayoutSetArgs{Patch: unknown})
	var coded *ipcerr.Error
	if !errors.As(err, &coded) || coded.Code != string(ipcerr.CodeContract) {
		t.Fatalf("Layout.Set(unknown mode) = %v, want %s", err, ipcerr.CodeContract)
	}
}
