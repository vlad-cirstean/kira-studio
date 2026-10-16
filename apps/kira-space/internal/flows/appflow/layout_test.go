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
	if got := merged.Panel.Project.Width; got != 260 {
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
